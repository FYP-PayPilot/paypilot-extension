import * as path from "path";
import * as vscode from "vscode";
import { DiffService } from "../diff/diffService";
import { checkBackendHealth, getAvailableModels, getLanguageModel } from "../language-model/languageModelService";
import { StatusBarService } from "../diff/statusBarService";
import { McpService } from "../mcp/mcpService";
import { ContextService } from "../context/contextService";
import { PromptService } from "./promptService";
import { ContextMessageService } from "../context/contextMessageService";
import { McpMessageService } from "../mcp/mcpMessageService";
import { ModelMessageService } from "../language-model/modelMessageService";
import { ChatHistoryService } from "./chatHistoryService";
import { ChatMessage, FileChange } from "../../types/chat";
import { FileOperation } from "../../types/diff";
import { resolveWorkspaceUri, relativeUriPath } from "../../utils/workspace";

const WORKSPACE_CONTEXT_TOOL_NAME = "paypilot-workspaceContext";
const CREATE_FILE_TOOL_NAME = "paypilot-createFile";
const UPDATE_FILE_TOOL_NAME = "paypilot-updateFile";
const DELETE_FILE_TOOL_NAME = "paypilot-deleteFile";
const CREATE_DIRECTORY_TOOL_NAME = "paypilot-createDirectory";
const READ_FILE_TOOL_NAME = "paypilot-readFile";
const DELETE_DIRECTORY_TOOL_NAME = "paypilot-deleteDirectory";

/**
 * Orchestrates chat requests, AI responses, diff tracking, context management, MCP configuration and chat management. 
 * Acts as the bridge between the webview and backend services.
 */
export class MessageHandlerService {
  private currentAbortController: AbortController | null = null;
  private readonly diffService: DiffService;
  private readonly statusBarService: StatusBarService;
  private readonly mcpService: McpService;
  private readonly contextService: ContextService;
  private readonly promptService: PromptService;
  private readonly contextMessageService: ContextMessageService;
  private readonly mcpMessageService: McpMessageService;
  private readonly modelMessageService: ModelMessageService;
  private readonly chatHistoryService: ChatHistoryService;
  private agentChangeLog: string[] = [];
  private currentSessionFileChanges: Array<{
    fileName: string;
    filePath: string;
    operation:
      | "create"
      | "update"
      | "delete"
      | "directory"
      | "directory-delete"
      | "read";
    linesAdded?: number;
    linesDeleted?: number;
  }> = [];

  constructor(
    workspaceState: vscode.Memento,
    private readonly chatTools: vscode.LanguageModelChatTool[]
  ) {
    this.statusBarService = new StatusBarService();
    this.diffService = new DiffService(this.statusBarService, workspaceState);
    this.mcpService = new McpService();
    this.contextService = new ContextService();
    this.promptService = new PromptService();
    this.contextMessageService = new ContextMessageService(this.contextService);
    this.mcpMessageService = new McpMessageService(this.mcpService);
    this.modelMessageService = new ModelMessageService();
    this.chatHistoryService = new ChatHistoryService();
  }

  /**
   * Open the diff view for the first tracked file.
   * Used by the `paypilot.openDiff` command.
   * @returns Promise that resolves when the operation completes.
   */
  async openDiffView(): Promise<void> {
    const tracked = this.diffService.getActiveDiffFiles();
    if (tracked.length === 0) {
      vscode.window.showInformationMessage("No modified files to review");
      return;
    }

    await this.diffService.openDiffForFile(tracked[0]);
    this.diffService.refreshStatusBarButtons();
  }

  /**
   * Dispatch messages from the chat webview to their handlers.
   * @param msg The message payload from the webview.
   * @param panel The webview panel to communicate back to.
   * @returns Promise that resolves when processing completes.
   */
  async handleMessage(msg: unknown, panel: vscode.Webview): Promise<void> {
    const message = msg as ChatMessage | undefined;
    const messageType = message?.type;

    switch (messageType) {
      case "chat:ask":
        await this.handleChatAsk(message, panel);
        break;
      case "chat:stop":
        await this.handleChatStop(panel);
        break;
      case "chat:new":
        await this.handleNewChat(message, panel);
        break;
      case "chat:history":
        await this.handleChatHistory(panel);
        break;
      case "model:list-request":
        await this.modelMessageService.sendAvailableModels(panel);
        break;
      case "model:change":
        await this.modelMessageService.handleModelChange(message);
        break;
      case "file:open":
        await this.handleFileOpen(message);
        break;
      case "context:request":
        await this.contextMessageService.respondToContextRequest(panel);
        break;
      case "context:add":
        await this.contextMessageService.addFiles(message?.filePaths, panel);
        break;
      case "context:remove":
        this.contextMessageService.removeFile(message?.filePath, panel);
        break;
      case "context:clear":
        this.contextMessageService.clearAll(panel);
        break;
      case "mcp:toggle":
        this.mcpMessageService.toggle(Boolean(message?.enabled));
        break;
      case "mcp:get":
        await this.mcpMessageService.sendServers(panel);
        break;
      default:
        console.warn(`[PayPilot] Unknown message type: ${messageType}`);
        break;
    }
  }

  /**
   * Process a `chat:ask` request from the webview.
   * Selects the requested language model, streams the response, and applies
   * modifications when the agent mode is used.
   * @param msg The message payload from the webview.
   * @param panel The webview panel to communicate back to.
   * @returns Promise that resolves when processing completes.
   */
  private async handleChatAsk(msg: ChatMessage | undefined, panel: vscode.Webview): Promise<void> {
    try {
    // Check backend health first
    const backendHealthy = await checkBackendHealth();
    if (!backendHealthy) {
      panel.postMessage({
        type: "chat:error",
        error: "Backend server is not reachable.",
      });
      return;
    }

      // Get the specific language model to use
      let selectedModel = null;
      if (msg?.model) {
        selectedModel = await getLanguageModel(msg.model);
      }
      
      if (!selectedModel) {
        const availableModels = await getAvailableModels();
        if (availableModels.length === 0) {
          panel.postMessage({
            type: "chat:error",
            error: "No language models available.",
          });
          return;
        }
        // Use requested model or fall back to first available
        selectedModel = msg?.model || availableModels[0].id;
      }

      const cfg = vscode.workspace.getConfiguration("paypilot");
      const maxContextChars = Math.max(0, Number(cfg.get("maxContextChars")) || 0);

      // Extract editor context for AI prompt
      const editorContext = this.contextService.getActiveEditorContext(maxContextChars);

      // Build context files content
      let contextFilesContent = "";
      const contextFilePaths = Array.isArray(msg?.contextFiles)
        ? msg.contextFiles.map((f: { filePath: string }) => f.filePath)
        : undefined;

      if (contextFilePaths && contextFilePaths.length > 0) {
        await this.contextMessageService.addFiles(contextFilePaths);
        contextFilesContent = this.contextService.buildContextContent();
      }

      const mode = typeof msg?.mode === "string" ? msg.mode : "ask";

      const composed = this.promptService.composePrompt(
        msg ?? {},
        mode,
        editorContext,
        contextFilesContent
      );

      // Store the current request for potential cancellation
      const abortController = new AbortController();
      this.currentAbortController = abortController;

      if (mode === "agent") {
        await this.handleAgentModeViaBackend(msg, panel, editorContext, contextFilesContent);
      } else {
        await this.handleAskModeViaBackend(msg, panel, editorContext, contextFilesContent);
      }
    } catch (error) {
      this.currentAbortController = null;
      console.error("Error in chat:ask handler:", error);
      panel.postMessage({
        type: "chat:error",
        error: error instanceof Error ? error.message : "An unknown error occurred",
      });
    }
  }

  private async handleAgentModeViaBackend(
    msg: ChatMessage | undefined,
    panel: vscode.Webview,
    editorContext: string,
    contextFilesContent: string
  ): Promise<void> {
    const backendUrl = "http://localhost:8000";
    
    panel.postMessage({
      type: "chat:working",
      message: "Processing your request..."
    });

    try {
      const response = await fetch(`${backendUrl}/chat/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: msg?.model || "gpt-4",
          user_prompt: msg?.prompt || "",
          editor_context: editorContext,
          file_context: contextFilesContent,
          workspace_root: vscode.workspace.workspaceFolders?.[0].uri.fsPath,
          max_tokens: 4000,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Backend request failed");
      }

      const data = await response.json();
      
      panel.postMessage({
        type: "chat:done",
        text: data.response
      });

    } catch (error) {
      console.error("Backend error:", error);
      panel.postMessage({
        type: "chat:error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handleAskModeViaBackend(
    msg: ChatMessage | undefined,
    panel: vscode.Webview,
    editorContext: string,
    contextFilesContent: string
  ): Promise<void> {
    const backendUrl = "http://localhost:8000";
    
    panel.postMessage({
      type: "chat:working",
      message: "Processing your request..."
    });

    try {
      const response = await fetch(`${backendUrl}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: msg?.model || "gpt-4",
          user_prompt: msg?.prompt || "",
          editor_context: editorContext,
          file_context: contextFilesContent,
          workspace_root: vscode.workspace.workspaceFolders?.[0].uri.fsPath,
          max_tokens: 4000,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Backend request failed");
      }

      const data = await response.json();
      
      panel.postMessage({
        type: "chat:done",
        text: data.response
      });

    } catch (error) {
      console.error("Backend error:", error);
      panel.postMessage({
        type: "chat:error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Execute agent mode: loop on tool-capable responses, invoke workspace tools, and track resulting edits.
   * @param selectedModel The language model to use for the request.
   * @param composed The fully composed prompt to send to the model.
   * @param panel The webview panel to communicate back to.
   * @param abortController Controller to allow cancellation of the request.
   * @returns Promise that resolves when processing completes.
   */
  private async handleAgentMode(
    selectedModel: vscode.LanguageModelChat,
    composed: string,
    panel: vscode.Webview,
    abortController: AbortController
  ): Promise<void> {
    console.log("[PayPilot] Starting Agent Mode");
    panel.postMessage({
      type: "chat:working",
      message: "Analyzing code and preparing changes...",
    });

    const conversation: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(composed),
    ];
    this.agentChangeLog = [];
    const agentPlan: string[] = [];
    let planSent = false;

    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const { signal } = abortController;
    const listener = () => {
      cancellationTokenSource.cancel();
    };
    signal.addEventListener("abort", listener, { once: true });

    let aggregatedResponse = "";

    try {
      while (true) {
        const response = await selectedModel.sendRequest(
          conversation,
          {
            justification: "PayPilot agent request",
            tools: this.chatTools,
            toolMode: vscode.LanguageModelChatToolMode.Auto,
          },
          cancellationTokenSource.token
        );

        const toolCalls: vscode.LanguageModelToolCallPart[] = [];
        const textParts: vscode.LanguageModelTextPart[] = [];

        for await (const part of response.stream) {
          if (cancellationTokenSource.token.isCancellationRequested) {
            break;
          }

          if (part instanceof vscode.LanguageModelTextPart) {
            aggregatedResponse += part.value;
            textParts.push(part);
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push(part);
          }
        }

        if (cancellationTokenSource.token.isCancellationRequested) {
          throw new Error("Request cancelled");
        }

        if (toolCalls.length === 0) {
          if (!planSent) {
            const planSteps = agentPlan.length > 0 ? agentPlan : this.parsePlanLines(aggregatedResponse);
            if (planSteps.length > 0) {
              if (agentPlan.length === 0) {
                agentPlan.push(...planSteps);
              }
              panel.postMessage({
                type: 'chat:agent-plan',
                title: 'Proposed plan',
                steps: planSteps,
              });
              planSent = true;
            }
          }
          if (!planSent && agentPlan.length > 0) {
            panel.postMessage({
              type: 'chat:agent-plan',
              title: 'Proposed plan',
              steps: agentPlan,
            });
            planSent = true;
          }
          const summary = this.formatAgentChangeSummary();
          const baseText = aggregatedResponse.trim();
          const finalText = summary
            ? baseText
              ? `${baseText}\n\n---\n${summary}`
              : summary
            : aggregatedResponse;
          panel.postMessage({ type: 'chat:done', text: finalText });
          if (summary) {
            panel.postMessage({ type: 'chat:agent-summary', text: summary });
          }

          // Send multi-file edit summary if there were file changes
          this.sendMultiFileEditSummary(panel);
          break;
        }

        if (textParts.length > 0) {
          conversation.push(vscode.LanguageModelChatMessage.Assistant(textParts));
          if (!planSent) {
            const planSteps = this.extractPlanSteps(textParts);
            if (planSteps.length > 0) {
              agentPlan.push(...planSteps);
              panel.postMessage({
                type: 'chat:agent-plan',
                title: 'Proposed plan',
                steps: planSteps,
              });
              planSent = true;
            }
          }
        }

        for (let index = 0; index < toolCalls.length; index += 1) {
          const call = toolCalls[index];
          try {
            const resultPart = await this.invokeToolCall(call, panel);
            conversation.push(vscode.LanguageModelChatMessage.Assistant([call]));
            conversation.push(vscode.LanguageModelChatMessage.User([resultPart]));
            if (!planSent) {
              const planSteps = this.extractPlanFromToolResult(resultPart);
              if (planSteps.length > 0) {
                agentPlan.push(...planSteps);
                panel.postMessage({
                  type: "chat:agent-plan",
                  title: "Proposed plan",
                  steps: planSteps,
                });
                planSent = true;
              }
            }
            const hasMoreCalls = index < toolCalls.length - 1;
            this.injectWorkspaceRefreshIfNeeded(conversation, call, hasMoreCalls);
          } catch (toolError) {
            console.error("[PayPilot] Tool invocation failed", toolError);
            panel.postMessage({
              type: "chat:error",
              error:
                toolError instanceof Error
                  ? toolError.message
                  : String(toolError),
            });
            return;
          }
        }
      }
    } catch (agentError) {
      console.error("Error in agent mode:", agentError);
      panel.postMessage({
        type: "chat:error",
        error: agentError instanceof Error ? agentError.message : String(agentError),
      });
    } finally {
      this.agentChangeLog = [];
      this.currentAbortController = null;
      cancellationTokenSource.dispose();
      signal.removeEventListener("abort", listener);
    }
  }

  /**
   * Execute ask mode: stream the model's text back to the chat UI.
   * @param selectedModel The language model to use for the request.
   * @param composed The fully composed prompt to send to the model.
   * @param panel The webview panel to communicate back to.
   * @param abortController Controller to allow cancellation of the request.
   * @returns Promise that resolves when processing completes.
   */
  private async handleAskMode(
    selectedModel: vscode.LanguageModelChat,
    composed: string,
    panel: vscode.Webview,
    abortController: AbortController
  ): Promise<void> {
    console.log("[PayPilot] Starting Ask Mode");

    const conversation: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(composed),
    ];
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const { signal } = abortController;
    const listener = () => cancellationTokenSource.cancel();
    signal.addEventListener("abort", listener, { once: true });

    const askModeTools = this.getAskModeTools();
    let aggregatedResponse = "";

    try {
      while (true) {
        const requestOptions: vscode.LanguageModelChatRequestOptions = {
          justification: "PayPilot ask request",
        };
        if (askModeTools.length > 0) {
          requestOptions.tools = askModeTools;
          requestOptions.toolMode = vscode.LanguageModelChatToolMode.Auto;
        }

        const response = await selectedModel.sendRequest(
          conversation,
          requestOptions,
          cancellationTokenSource.token
        );

        const toolCalls: vscode.LanguageModelToolCallPart[] = [];
        const textParts: vscode.LanguageModelTextPart[] = [];

        for await (const part of response.stream) {
          if (cancellationTokenSource.token.isCancellationRequested) {
            break;
          }

          if (part instanceof vscode.LanguageModelTextPart) {
            aggregatedResponse += part.value;
            textParts.push(part);
            panel.postMessage({ type: "chat:stream", token: part.value });
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push(part);
          }
        }

        if (cancellationTokenSource.token.isCancellationRequested) {
          throw new Error("Request cancelled");
        }

        if (textParts.length > 0) {
          conversation.push(vscode.LanguageModelChatMessage.Assistant(textParts));
        }

        if (toolCalls.length === 0) {
          panel.postMessage({ type: "chat:done", text: aggregatedResponse });
          break;
        }

        for (let index = 0; index < toolCalls.length; index += 1) {
          const call = toolCalls[index];
          try {
            const resultPart = await this.invokeToolCall(call, panel);
            conversation.push(vscode.LanguageModelChatMessage.Assistant([call]));
            conversation.push(vscode.LanguageModelChatMessage.User([resultPart]));
            const hasMoreCalls = index < toolCalls.length - 1;
            this.injectWorkspaceRefreshIfNeeded(conversation, call, hasMoreCalls);
          } catch (toolError) {
            console.error("[PayPilot] Tool invocation failed in ask mode", toolError);
            panel.postMessage({
              type: "chat:error",
              error:
                toolError instanceof Error ? toolError.message : String(toolError),
            });
            return;
          }
        }
      }
    } catch (chatError) {
      if (!(chatError instanceof Error && chatError.message === "Request cancelled")) {
        console.error("Error in chat mode:", chatError);
        panel.postMessage({
          type: "chat:error",
          error: chatError instanceof Error ? chatError.message : String(chatError),
        });
      }
    } finally {
      this.currentAbortController = null;
      cancellationTokenSource.dispose();
      signal.removeEventListener("abort", listener);
    }
  }

  private injectWorkspaceRefreshIfNeeded(
    _conversation: vscode.LanguageModelChatMessage[],
    _call: vscode.LanguageModelToolCallPart,
    _hasMoreCallsInBatch: boolean
  ): void {
    // Prompt guidance already covers follow-up workspace queries.
  }

  private recordAgentChange(entry: string | undefined): void {
    if (!entry) {
      return;
    }
    if (!this.agentChangeLog.includes(entry)) {
      this.agentChangeLog.push(entry);
    }
  }

  private formatAgentChangeSummary(): string {
    if (this.agentChangeLog.length === 0) {
      return "";
    }
    const lines = this.agentChangeLog.map((entry) => `• ${entry}`);
    return [`Summary of applied changes:`, ...lines].join("\n");
  }

  private extractPlanSteps(textParts: vscode.LanguageModelTextPart[]): string[] {
    const raw = textParts
      .map((part) => part.value)
      .join('')
      .trim();
    return this.parsePlanLines(raw);
  }

  private extractPlanFromToolResult(
    resultPart: vscode.LanguageModelToolResultPart
  ): string[] {
    const raw = resultPart.content
      .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ''))
      .join('')
      .trim();
    return this.parsePlanLines(raw);
  }

  private parsePlanLines(raw: string): string[] {
    if (!raw) {
      return [];
    }

    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const steps = lines
      .filter((line) => /^(?:\d+[\).]|step\s*\d+:|[-*])\s+/i.test(line))
      .map((line) => line.replace(/^(?:\d+[\).]|step\s*\d+:|[-*])\s+/i, '').trim());

    if (steps.length > 0) {
      return steps;
    }

    if (lines.length > 1 && raw.toLowerCase().includes('plan')) {
      return lines;
    }

    return [];
  }

  private getAskModeTools(): vscode.LanguageModelChatTool[] {
    return this.chatTools.filter((tool) =>
      tool.name === WORKSPACE_CONTEXT_TOOL_NAME ||
      tool.name === READ_FILE_TOOL_NAME
    );
  }

  private async invokeToolCall(
    call: vscode.LanguageModelToolCallPart,
    panel: vscode.Webview
  ): Promise<vscode.LanguageModelToolResultPart> {
    if (!call?.name) {
      throw new Error("Invalid tool call: missing name");
    }

    const context = await this.prepareToolContext(call);

    const result = await vscode.lm.invokeTool(call.name, {
      toolInvocationToken: undefined,
      input: call.input,
    });

    this.notifyToolActivity(call, panel, context);

    if (context) {
      await this.applyToolSideEffects(context, call, result, panel);
    }

    return new vscode.LanguageModelToolResultPart(call.callId, result.content);
  }

  private async prepareToolContext(
    call: vscode.LanguageModelToolCallPart
  ): Promise<
    | {
        uri: vscode.Uri;
        operation: FileOperation;
        originalContent: string;
        isDirectory?: boolean;
        directorySnapshot?: string;
      }
    | undefined
  > {
    switch (call.name) {
      case CREATE_FILE_TOOL_NAME: {
        const target = resolveWorkspaceUri((call.input as { path: string }).path);
        const { content, exists } = await this.readFileSnapshot(target);
        return {
          uri: target,
          operation: exists ? "update" : "create",
          originalContent: content,
        };
      }
      case UPDATE_FILE_TOOL_NAME: {
        const target = resolveWorkspaceUri((call.input as { path: string }).path);
        const { content } = await this.readFileSnapshot(target);
        return {
          uri: target,
          operation: "update",
          originalContent: content,
        };
      }
      case DELETE_FILE_TOOL_NAME: {
        const target = resolveWorkspaceUri((call.input as { path: string }).path);
        const { content, exists } = await this.readFileSnapshot(target);
        if (!exists) {
          return undefined;
        }
        return {
          uri: target,
          operation: "delete",
          originalContent: content,
        };
      }
      case CREATE_DIRECTORY_TOOL_NAME: {
        const target = resolveWorkspaceUri((call.input as { path: string }).path);
        const snapshot = await this.captureDirectorySnapshot(target);
        const exists = snapshot !== undefined;
        return {
          uri: target,
          operation: exists ? "update" : "create",
          originalContent: exists ? snapshot ?? "" : "",
          isDirectory: true,
          directorySnapshot: snapshot,
        };
      }
      case DELETE_DIRECTORY_TOOL_NAME: {
        const target = resolveWorkspaceUri((call.input as { path: string }).path);
        const snapshot = await this.captureDirectorySnapshot(target);
        if (!snapshot) {
          return undefined;
        }
        return {
          uri: target,
          operation: "delete",
          originalContent: "",
          isDirectory: true,
          directorySnapshot: snapshot,
        };
      }
      default:
        return undefined;
    }
  }

  private notifyToolActivity(
    call: vscode.LanguageModelToolCallPart,
    panel: vscode.Webview,
    context?: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
    }
  ): void {
    const activity = this.describeToolActivity(call, context);
    if (!activity) {
      return;
    }

    panel.postMessage({
      type: "chat:tool-activity",
      ...activity,
    });

    // Track file changes for summary
    if (activity.filePath && activity.operation) {
      const fileName = path.basename(activity.filePath);
      const fileChange: FileChange = {
        fileName,
        filePath: activity.filePath,
        operation: activity.operation as any,
      };

      // Add line change information if available from context
      if (context) {
        // For file operations, we'll calculate lines later if needed
        // For now, just track the operation
        this.currentSessionFileChanges.push(fileChange);
      } else {
        this.currentSessionFileChanges.push(fileChange);
      }
    }

    if (
      activity.operation === "directory" ||
      activity.operation === "directory-delete"
    ) {
      const description = `${
        activity.operation === "directory" ? "Created" : "Deleted"
      } ${activity.detail ?? activity.title}`;
      this.recordAgentChange(description);
    }
  }

  private describeToolActivity(
    call: vscode.LanguageModelToolCallPart,
    context?: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
    }
  ): { title: string; detail?: string; filePath?: string; operation?: string } | undefined {
    try {
      if (call.name === WORKSPACE_CONTEXT_TOOL_NAME) {
        return { title: "Gathering workspace context…", operation: "context" };
      }

      const input = call.input as { path?: string } | undefined;
      const candidatePath = input?.path;
      const targetUri = context?.uri ?? (candidatePath ? resolveWorkspaceUri(candidatePath) : undefined);

      if (!targetUri) {
        if (call.name === READ_FILE_TOOL_NAME) {
          return { title: "Reading workspace data", operation: "read" };
        }
        return undefined;
      }

      const relativePath = relativeUriPath(targetUri);
      const fileName = path.basename(targetUri.fsPath);

      switch (call.name) {
        case CREATE_FILE_TOOL_NAME: {
          const verb = context?.operation === "create" ? "created" : "updated";
          return {
            title: `${fileName} ${verb}`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: context?.operation ?? "create",
          };
        }
        case UPDATE_FILE_TOOL_NAME: {
          return {
            title: `${fileName} updated`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "update",
          };
        }
        case DELETE_FILE_TOOL_NAME: {
          return {
            title: `${fileName} deleted`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "delete",
          };
        }
        case CREATE_DIRECTORY_TOOL_NAME: {
          return {
            title: `${fileName || relativePath} directory created`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "directory",
          };
        }
        case DELETE_DIRECTORY_TOOL_NAME: {
          return {
            title: `${fileName || relativePath} directory deleted`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "directory-delete",
          };
        }
        case READ_FILE_TOOL_NAME: {
          return {
            title: `${fileName} read`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "read",
          };
        }
        default:
          return {
            title: `Invoked ${call.name}`,
            detail: relativePath,
            filePath: targetUri.fsPath,
          };
      }
    } catch (error) {
      console.warn("[PayPilot] Failed to describe tool activity", error);
      return undefined;
    }
  }

  private sendMultiFileEditSummary(panel: vscode.Webview): void {
    if (this.currentSessionFileChanges.length === 0) {
      return;
    }

    // Calculate totals
    const totalLinesAdded = this.currentSessionFileChanges.reduce(
      (sum, change) => sum + (change.linesAdded || 0),
      0
    );
    const totalLinesDeleted = this.currentSessionFileChanges.reduce(
      (sum, change) => sum + (change.linesDeleted || 0),
      0
    );

    // Send the summary message
    panel.postMessage({
      type: "chat:multi-file-edit-summary",
      changes: this.currentSessionFileChanges,
      totalLinesAdded,
      totalLinesDeleted,
    });

    // Clear the changes for the next session
    this.currentSessionFileChanges = [];
  }

  private async applyToolSideEffects(
    context: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
      isDirectory?: boolean;
      directorySnapshot?: string;
    },
    call: vscode.LanguageModelToolCallPart,
    result: vscode.LanguageModelToolResult,
    panel: vscode.Webview
  ): Promise<void> {
    if (context.isDirectory) {
      await this.diffService.trackModifiedFiles([
        {
          filePath: context.uri.fsPath,
          originalContent: context.originalContent,
          operation: context.operation,
          isDirectory: true,
          directorySnapshot: context.directorySnapshot,
        },
      ]);

      if (context.operation === 'delete') {
        this.contextMessageService.handleExternalRemoval(context.uri.fsPath, panel);
      }

      this.recordAgentChange(
        `${this.describeOperation(context.operation, context.uri.fsPath)} (${relativeUriPath(context.uri)})`
      );

      panel.postMessage({
        type: "chat:code-applied",
        fileName: path.basename(context.uri.fsPath),
        filePath: context.uri.fsPath,
        linesAdded: 0,
        linesDeleted: 0,
        explanation: this.describeOperation(context.operation, context.uri.fsPath),
        operation: context.operation,
      });
      return;
    }

    let nextContent = "";

    if (context.operation !== "delete") {
      try {
        nextContent = await this.readFileAfterTool(context.uri);
      } catch (error) {
        console.warn(
          `[PayPilot] Failed to read modified file ${context.uri.fsPath}:`,
          error
        );
      }
    }

    if (context.operation === "delete") {
      this.contextMessageService.handleExternalRemoval(context.uri.fsPath, panel);
    }

    const diffStats = this.diffService.calculateDiffStats(
      context.originalContent.split("\n"),
      context.operation === "delete" ? [] : nextContent.split("\n")
    );

    await this.diffService.trackModifiedFiles([
      {
        filePath: context.uri.fsPath,
        originalContent: context.originalContent,
        operation: context.operation,
      },
    ]);

    panel.postMessage({
      type: "chat:code-applied",
      fileName: path.basename(context.uri.fsPath),
      filePath: context.uri.fsPath,
      linesAdded: diffStats.added,
      linesDeleted: diffStats.deleted,
      explanation: this.describeOperation(context.operation, context.uri.fsPath),
      operation: context.operation,
    });

    const relative = relativeUriPath(context.uri);
    this.recordAgentChange(
      `${this.describeOperation(context.operation, context.uri.fsPath)} (${relative})`
    );

    // log tool result for transparency
    const resultText = result.content
      .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
      .join("")
      .trim();
    if (resultText) {
      console.log(`[PayPilot] Tool ${call.name} result: ${resultText}`);
    }
  }

  private describeOperation(operation: FileOperation, filePath: string): string {
    const fileName = path.basename(filePath);
    switch (operation) {
      case "create":
        return `Created ${fileName}`;
      case "delete":
        return `Deleted ${fileName}`;
      default:
        return `Updated ${fileName}`;
    }
  }

  private async readFileSnapshot(uri: vscode.Uri): Promise<{ content: string; exists: boolean }> {
    try {
      const buffer = await vscode.workspace.fs.readFile(uri);
      return { content: Buffer.from(buffer).toString("utf8"), exists: true };
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return { content: "", exists: false };
      }
      throw error;
    }
  }

  private async readFileAfterTool(uri: vscode.Uri): Promise<string> {
    const buffer = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(buffer).toString("utf8");
  }

  private async captureDirectorySnapshot(uri: vscode.Uri): Promise<string | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (!(stat.type & vscode.FileType.Directory)) {
        return undefined;
      }
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return undefined;
      }
      throw error;
    }

    const entries: Array<{ path: string; type: 'file' | 'directory'; content?: string }> = [];
    await this.collectDirectoryEntries(uri, uri, entries);
    return JSON.stringify(entries);
  }

  private async collectDirectoryEntries(
    baseUri: vscode.Uri,
    currentUri: vscode.Uri,
    entries: Array<{ path: string; type: 'file' | 'directory'; content?: string }>
  ): Promise<void> {
    const relative = path
      .relative(baseUri.fsPath, currentUri.fsPath)
      .replace(/\\/g, '/');
    if (relative && relative !== '') {
      entries.push({ path: relative, type: 'directory' });
    }

    const children = await vscode.workspace.fs.readDirectory(currentUri);
    for (const [name, type] of children) {
      const childUri = vscode.Uri.joinPath(currentUri, name);
      if (type & vscode.FileType.Directory) {
        await this.collectDirectoryEntries(baseUri, childUri, entries);
      } else if (type & vscode.FileType.File) {
        const content = await vscode.workspace.fs.readFile(childUri);
        const relativeChild = path
          .relative(baseUri.fsPath, childUri.fsPath)
          .replace(/\\/g, '/');
        entries.push({
          path: relativeChild,
          type: 'file',
          content: Buffer.from(content).toString('base64'),
        });
      }
    }
  }

  /**
   * Stop the active streaming request, if any, and notify the webview.
   * @param panel The webview panel to communicate back to.
   * @returns Promise that resolves when the operation completes.
   */
  private async handleChatStop(panel: vscode.Webview): Promise<void> {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
      panel.postMessage({ type: "chat:stopped" });
    }
  }

  /**
   * Start a new chat session, optionally with a title.
   * @param message The message payload from the webview, possibly containing a title.
   * @param panel The webview panel to communicate back to.
   * @returns Promise that resolves when the operation completes.
   */
  private async handleNewChat(message: ChatMessage | undefined, panel: vscode.Webview): Promise<void> {
    const session = this.chatHistoryService.createSession(message?.title);
    panel.postMessage({
      type: "chat:new-response",
      success: true,
      session,
    });
  }

  /**
   * Return currently known chat sessions to the webview.
   * @param panel The webview panel to communicate back to.
   * @returns Promise that resolves when the operation completes.
   */
  private async handleChatHistory(panel: vscode.Webview): Promise<void> {
    const sessions = this.chatHistoryService.listSessions();
    panel.postMessage({
      type: "chat:history-response",
      sessions,
    });
  }

  /**
   * Open a file requested by the chat webview in the editor.
   * @param message The message payload from the webview, containing the file path.
   * @returns Promise that resolves when the operation completes.
   */
  private async handleFileOpen(message?: ChatMessage): Promise<void> {
    try {
      const filePath = message?.filePath;
      if (!filePath) {
        return;
      }
      const uri = vscode.Uri.file(filePath);
      await vscode.window.showTextDocument(uri);
    } catch (error) {
      console.error("Error opening file:", error);
      vscode.window.showErrorMessage(`Failed to open file: ${message?.filePath ?? "unknown"}`);
    }
  }

  /**
   * Track chat panel visibility so status bar controls mirror the UI.
   * Called from the extension entrypoint when the webview visibility changes.
   * @param visible True when the chat webview is visible.
   * @returns void
   */
  setChatPanelVisibility(visible: boolean): void {
    this.statusBarService.setChatPanelVisibility(visible);
    
    // show diff buttons only when the panel is visible and there are tracked changes
    if (visible && this.diffService.hasChanges()) {
      const totalFiles = this.diffService.getActiveDiffFiles().length;
      this.statusBarService.showEnhancedDiffButtons(
        true,
        this.diffService.activeFileHasChanges(),
        totalFiles,
        this.diffService.isActiveDiffOpen()
      );
    } else if (!visible) {
      this.statusBarService.cleanupStatusBarItems();
    }
  }

  /**
   * Expose the diff service to the extension entrypoint for command registration.
   */
  getDiffService(): DiffService {
    return this.diffService;
  }

  /**
   * Expose the MCP service to the extension entrypoint for configuration helpers.
   */
  getMcpService(): McpService {
    return this.mcpService;
  }

  /**
   * Dispose underlying services and cancel in-flight requests.
   */
  dispose(): void {
    this.statusBarService.dispose();
    this.diffService.dispose(); // Now handles both regular and sequential cleanup
    this.contextMessageService.clearAll();
    this.mcpService.reset();
    
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    
    console.log("[PayPilot] MessageHandlerService disposed");
  }
}
