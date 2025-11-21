/**
 * WebSocket-based Agent Client for VSCode Extension (Enhanced Version)
 * Integrates with existing MessageHandlerService infrastructure
 * Includes request tracking for promise-based completion (like getChatAgent)
 */

import * as vscode from "vscode";
import WebSocket from "ws";
import * as path from "path";
import { resolveWorkspaceUri } from "../../utils/workspace";
import { MessageHandlerService } from "../chat/messageHandlerService";

interface ToolRequest {
  type: "tool_request";
  request_id: string;
  tool_name: string;
  tool_args: Record<string, any>;
  workspace_root: string;
}

interface AgentResponse {
  type: "agent_response";
  request_id?: string; // Optional for backward compatibility
  response: string;
  model_used: string;
  stats: {
    iterations: number;
    tool_calls: number;
    tokens_used: number;
  };
}

interface StatusUpdate {
  type: "status";
  message: string;
}

interface ErrorMessage {
  type: "error";
  request_id?: string;
  message: string;
}

type ServerMessage =
  | ToolRequest
  | AgentResponse
  | StatusUpdate
  | ErrorMessage
  | { type: "pong" };

export class AgentWebSocketClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;

  // Integration with existing infrastructure
  private messageHandler: MessageHandlerService;
  private webviewPanel?: vscode.Webview;

  // Request tracking for promise-based completion
  private pendingRequests: Map<
    string,
    {
      resolve: (response: AgentResponse) => void;
      reject: (error: Error) => void;
      abortController?: AbortController;
    }
  > = new Map();

  // Legacy callback support (optional)
  public onStatusUpdate?: (message: string) => void;
  public onResponse?: (response: AgentResponse) => void;
  public onError?: (error: string) => void;
  public onConnectionChange?: (connected: boolean) => void;

  constructor(
    messageHandler: MessageHandlerService,
    serverUrl: string = "ws://localhost:8000/ws/agent"
  ) {
    this.messageHandler = messageHandler;
    this.serverUrl = serverUrl;
  }

  /**
   * Set the webview panel for notifications
   */
  public setWebview(webview: vscode.Webview): void {
    this.webviewPanel = webview;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          console.log("[WebSocket] Connected to agent server");
          this.reconnectAttempts = 0;
          this.startPingInterval();
          this.onConnectionChange?.(true);

          if (this.webviewPanel) {
            this.webviewPanel.postMessage({
              type: "chat:status",
              status: "connected",
              message: "Connected to AI Agent server",
            });
          }

          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data.toString());
        };

        this.ws.onclose = (event) => {
          console.log("[WebSocket] Disconnected:", event.code, event.reason);
          this.stopPingInterval();
          this.onConnectionChange?.(false);

          // Reject all pending requests
          this.rejectAllPendingRequests(new Error("WebSocket disconnected"));

          if (this.webviewPanel) {
            this.webviewPanel.postMessage({
              type: "chat:status",
              status: "disconnected",
              message: "Disconnected from AI Agent server",
            });
          }

          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error("[WebSocket] Error:", error);
          this.onError?.("WebSocket connection error");

          if (this.webviewPanel) {
            this.webviewPanel.postMessage({
              type: "chat:error",
              error: "WebSocket connection error",
            });
          }

          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.stopPingInterval();

    // Reject all pending requests
    this.rejectAllPendingRequests(
      new Error("WebSocket disconnected by client")
    );

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send an agent request and wait for completion (like getChatAgent)
   * This is the recommended method for MessageHandlerService integration
   */
  async sendAgentRequestWithCompletion(
    request: {
      model_id: string;
      user_prompt: string;
      editor_context?: string;
      file_context?: string;
      workspace_root?: string;
      max_tokens?: number;
      temperature?: number;
    },
    abortController?: AbortController
  ): Promise<AgentResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    // Generate unique request ID
    const requestId = `req_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Create completion promise
    const completionPromise = new Promise<AgentResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        abortController,
      });

      // Handle abort
      if (abortController) {
        const abortHandler = () => {
          this.pendingRequests.delete(requestId);
          reject(new Error("Request was cancelled"));
        };

        if (abortController.signal.aborted) {
          abortHandler();
          return;
        }

        abortController.signal.addEventListener("abort", abortHandler);
      }
    });

    // Send status to UI
    if (this.webviewPanel) {
      this.webviewPanel.postMessage({
        type: "chat:status",
        status: "processing",
        message: "Sending request to agent...",
      });
    }

    // Send request with ID
    this.ws.send(
      JSON.stringify({
        type: "agent_request",
        request_id: requestId,
        ...request,
      })
    );

    console.log(`[WebSocket] Request sent with ID: ${requestId}`);

    return completionPromise;
  }

  /**
   * Send an agent request without waiting (fire and forget)
   * Legacy method for backward compatibility
   */
  async sendAgentRequest(request: {
    model_id: string;
    user_prompt: string;
    editor_context?: string;
    file_context?: string;
    workspace_root?: string;
    max_tokens?: number;
    temperature?: number;
  }): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    // Send status to UI
    if (this.webviewPanel) {
      this.webviewPanel.postMessage({
        type: "chat:status",
        status: "processing",
        message: "Sending request to agent...",
      });
    }

    this.ws.send(
      JSON.stringify({
        type: "agent_request",
        ...request,
      })
    );
  }

  /**
   * Handle incoming messages from server
   */
  private async handleMessage(data: string): Promise<void> {
    console.log("[WebSocket] Incoming message:", data);
    try {
      const message: ServerMessage = JSON.parse(data);

      switch (message.type) {
        case "tool_request":
          await this.handleToolRequest(message);
          break;

        case "agent_response":
          await this.handleAgentResponse(message);
          break;

        case "status":
          this.handleStatusUpdate(message);
          break;

        case "error":
          this.handleError(message);
          break;

        case "pong":
          // Keep-alive response
          break;

        default:
          console.warn("[WebSocket] Unknown message type:", message);
          // Send error back to server for unknown message type
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(
              JSON.stringify({
                type: "error",
                message: `Unknown message type: ${(message as any).type}`,
                request_id: (message as any).request_id || undefined,
              })
            );
          }
      }
    } catch (error) {
      console.error("[WebSocket] Failed to parse message:", error);
      // Send error back to server for malformed message
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "error",
            message: `Malformed message: ${error}`,
          })
        );
      }
    }
  }

  /**
   * Execute a tool using the existing MessageHandlerService infrastructure
   */
  private async handleToolRequest(request: ToolRequest): Promise<void> {
    console.log(
      `[WebSocket] Tool request: ${request.tool_name}`,
      request.tool_args
    );

    let result: any = null;
    let errorMessage: string | null = null;
    let sent = false;
    // Timeout logic: if tool execution takes >8s, send error result
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        if (!sent) {
          errorMessage = `Tool execution timeout for ${request.tool_name}`;
          console.error(
            `[WebSocket] Tool execution timeout:`,
            request.tool_name
          );
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(
              JSON.stringify({
                type: "tool_result",
                request_id: request.request_id,
                result: {
                  success: false,
                  error: errorMessage,
                },
              })
            );
            sent = true;
          }
        }
        resolve(null);
      }, 8000);
    });

    try {
      // Execute tool using integrated approach
      result = await Promise.race([
        this.executeToolIntegrated(request.tool_name, request.tool_args),
        timeoutPromise,
      ]);
      if (!sent) {
        // Send result back to server as JSON object (not stringified)
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: "tool_result",
              request_id: request.request_id,
              result: result,
            })
          );
          console.log(
            `[${new Date().toISOString()}] [WebSocket] Sent tool_result for ${request.tool_name}:`,
            JSON.stringify({
              type: "tool_result",
              request_id: request.request_id,
              result: result,
            })
          );
          sent = true;
        }
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[WebSocket] Tool execution error:`, error);
      if (!sent && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "tool_result",
            request_id: request.request_id,
            result: {
              success: false,
              error: errorMessage,
            },
          })
        );
        console.log(
          `[WebSocket] Sent tool_result error for ${request.tool_name}:`,
          errorMessage
        );
        sent = true;
      }
    }
  }

  /**
   * Execute tool using MessageHandlerService's infrastructure
   */
  private async executeToolIntegrated(
    toolName: string,
    toolArgs: any
  ): Promise<any> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceRoot) {
      return {
        success: false,
        error: "No workspace folder open",
      };
    }

    try {
      // Step 1: Prepare tool context
      const context = await this.messageHandler.prepareToolContextExternal(
        toolName,
        toolArgs
      );

      // Step 2: Notify tool activity
      if (context && this.webviewPanel) {
        this.messageHandler.notifyToolActivityExternal(
          toolName,
          toolArgs,
          context,
          this.webviewPanel
        );
      }

      // Step 3: Execute the tool locally
      const executionResult = await this.executeToolLocally(toolName, toolArgs);

      // Step 4: Apply side effects
      if (context && this.webviewPanel) {
        await this.messageHandler.applyToolSideEffectsExternal(
          context,
          toolName,
          executionResult,
          this.webviewPanel
        );
      }

      // Step 5: Return result
      return {
        success: true,
        result: executionResult,
      };
    } catch (error) {
      if (this.webviewPanel) {
        this.webviewPanel.postMessage({
          type: "chat:error",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute the actual tool operation
   */
  private async executeToolLocally(
    toolName: string,
    toolArgs: any
  ): Promise<any> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceRoot) {
      throw new Error("No workspace folder open");
    }

    switch (toolName) {
      case "paypilot-workspaceContext":
        return await this.getWorkspaceContext(toolArgs);
      case "paypilot-readFile":
        return await this.readFile(toolArgs);
      case "paypilot-createFile":
        return await this.createFile(toolArgs);
      case "paypilot-updateFile":
        return await this.updateFile(toolArgs);
      case "paypilot-deleteFile":
        return await this.deleteFile(toolArgs);
      case "paypilot-createDirectory":
        return await this.createDirectory(toolArgs);
      case "paypilot-deleteDirectory":
        return await this.deleteDirectory(toolArgs);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Handle final agent response from server
   */
  private async handleAgentResponse(response: AgentResponse): Promise<void> {
    console.log("[WebSocket] Agent response received");

    // Always ensure request_id is present
    if (!response.request_id) {
      console.warn(
        "[WebSocket] Agent response missing request_id, attempting to resolve with best match."
      );
      // Try to resolve with last pending request
      const lastRequestId = Array.from(this.pendingRequests.keys()).pop();
      if (lastRequestId) {
        response.request_id = lastRequestId;
      }
    }

    // Resolve pending request if tracked
    if (response.request_id && this.pendingRequests.has(response.request_id)) {
      const { resolve } = this.pendingRequests.get(response.request_id)!;
      this.pendingRequests.delete(response.request_id);
      resolve(response);
    }

    // Call legacy callback if set
    this.onResponse?.(response);
  }

  /**
   * Handle status updates from server
   */
  private handleStatusUpdate(update: StatusUpdate): void {
    console.log("[WebSocket] Status:", update.message);

    this.onStatusUpdate?.(update.message);

    if (this.webviewPanel) {
      this.webviewPanel.postMessage({
        type: "chat:status",
        status: "processing",
        message: update.message,
      });
    }
  }

  /**
   * Handle errors from server
   */
  private handleError(error: ErrorMessage): void {
    console.error("[WebSocket] Server error:", error.message);

    // Always ensure request_id is present
    if (!error.request_id) {
      console.warn(
        "[WebSocket] Error message missing request_id, attempting to resolve with best match."
      );
      // Try to resolve with last pending request
      const lastRequestId = Array.from(this.pendingRequests.keys()).pop();
      if (lastRequestId) {
        error.request_id = lastRequestId;
      }
    }

    // Reject specific pending request if request_id provided
    if (error.request_id && this.pendingRequests.has(error.request_id)) {
      const { reject } = this.pendingRequests.get(error.request_id)!;
      this.pendingRequests.delete(error.request_id);
      reject(new Error(error.message));
    } else {
      // Reject all pending requests
      this.rejectAllPendingRequests(new Error(error.message));
    }

    this.onError?.(error.message);

    if (this.webviewPanel) {
      this.webviewPanel.postMessage({
        type: "chat:error",
        error: error.message,
      });
    }
  }

  /**
   * Reject all pending requests (on disconnect or error)
   */
  private rejectAllPendingRequests(error: Error): void {
    for (const [requestId, { reject }] of this.pendingRequests.entries()) {
      reject(error);
    }
    this.pendingRequests.clear();
  }

  // ========================================================================
  // TOOL IMPLEMENTATIONS
  // ========================================================================

  private async getWorkspaceContext(args: {
    path?: string;
    maxDepth?: number;
  }): Promise<any> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri;
    if (!workspaceRoot) {
      return { error: "No workspace open" };
    }

    const targetPath = args.path || ".";
    const targetUri = resolveWorkspaceUri(targetPath);
    const maxDepth = args.maxDepth || 3;

    const structure = await this.buildDirectoryTree(targetUri, maxDepth, 0);

    return {
      path: targetPath,
      structure: structure,
      workspaceRoot: workspaceRoot.fsPath,
    };
  }

  private async buildDirectoryTree(
    uri: vscode.Uri,
    maxDepth: number,
    currentDepth: number
  ): Promise<any> {
    if (currentDepth >= maxDepth) {
      return null;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);

      if (stat.type === vscode.FileType.File) {
        return {
          name: path.basename(uri.fsPath),
          type: "file",
          path: uri.fsPath,
        };
      }

      const entries = await vscode.workspace.fs.readDirectory(uri);
      const children = await Promise.all(
        entries
          .filter(([name]) => !name.startsWith(".") && name !== "node_modules")
          .map(async ([name, type]) => {
            const childUri = vscode.Uri.joinPath(uri, name);
            if (type === vscode.FileType.Directory) {
              return await this.buildDirectoryTree(
                childUri,
                maxDepth,
                currentDepth + 1
              );
            }
            return {
              name,
              type: "file",
              path: childUri.fsPath,
            };
          })
      );

      return {
        name: path.basename(uri.fsPath),
        type: "directory",
        path: uri.fsPath,
        children: children.filter(Boolean),
      };
    } catch (error) {
      return { error: `Failed to read: ${uri.fsPath}` };
    }
  }

  private async readFile(args: { path: string }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);

    try {
      const content = await vscode.workspace.fs.readFile(uri);
      return {
        path: args.path,
        content: Buffer.from(content).toString("utf8"),
        success: true,
      };
    } catch (error) {
      return {
        path: args.path,
        error: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  private async createFile(args: {
    path: string;
    content: string;
  }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);

    try {
      const content = Buffer.from(args.content, "utf8");
      await vscode.workspace.fs.writeFile(uri, content);

      return {
        path: args.path,
        operation: "create",
        success: true,
        message: `Created ${path.basename(args.path)}`,
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async updateFile(args: {
    path: string;
    content: string;
  }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);

    try {
      const content = Buffer.from(args.content, "utf8");
      await vscode.workspace.fs.writeFile(uri, content);

      return {
        path: args.path,
        operation: "update",
        success: true,
        message: `Updated ${path.basename(args.path)}`,
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async deleteFile(args: { path: string }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);

    try {
      await vscode.workspace.fs.delete(uri);

      return {
        path: args.path,
        operation: "delete",
        success: true,
        message: `Deleted ${path.basename(args.path)}`,
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async createDirectory(args: { path: string }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);

    try {
      await vscode.workspace.fs.createDirectory(uri);

      return {
        path: args.path,
        operation: "create_directory",
        success: true,
        message: `Created directory ${path.basename(args.path)}`,
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async deleteDirectory(args: {
    path: string;
    recursive?: boolean;
  }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);

    try {
      await vscode.workspace.fs.delete(uri, {
        recursive: args.recursive ?? true,
      });

      return {
        path: args.path,
        operation: "delete_directory",
        success: true,
        message: `Deleted directory ${path.basename(args.path)}`,
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ========================================================================
  // CONNECTION MANAGEMENT
  // ========================================================================

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[WebSocket] Max reconnection attempts reached");

      if (this.webviewPanel) {
        this.webviewPanel.postMessage({
          type: "chat:error",
          error:
            "Unable to reconnect to agent server. Please check connection.",
        });
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[WebSocket] Reconnection failed:", err);
      });
    }, delay);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
