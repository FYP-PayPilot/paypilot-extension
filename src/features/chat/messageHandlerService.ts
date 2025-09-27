import * as path from "path";
import * as vscode from "vscode";
import { DiffService } from "../diff/diffService";
import { getAvailableModels, getLanguageModel } from "../language-model/languageModelService";
import { StatusBarService } from "../diff/statusBarService";
import { McpService } from "../mcp/mcpService";
import { ContextService } from "../context/contextService";
import { PromptService } from "./promptService";
import { ContextMessageService } from "../context/contextMessageService";
import { McpMessageService } from "../mcp/mcpMessageService";
import { ModelMessageService } from "../language-model/modelMessageService";
import { ChatHistoryService } from "./chatHistoryService";
import { ChatMessage } from "../../types/chat";
import { FileOperation } from "../../types/fileModification";
import { resolveWorkspaceUri } from "../../utils/workspace";

const WORKSPACE_CONTEXT_TOOL_NAME = "paypilot-workspaceContext";

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
      
      // Get the specific language model to use
      let selectedModel: vscode.LanguageModelChat | null = null;
      if (msg?.model) {
        selectedModel = await getLanguageModel(msg.model);
      }
      
      if (!selectedModel) {
        const availableModels = await getAvailableModels();
        if (availableModels.length === 0) {
          panel.postMessage({
            type: "chat:error",
            error: "No language models available. Please enable Copilot or sign in to VS Code.",
          });
          return;
        }
        selectedModel = await getLanguageModel(availableModels[0].id);
        if (!selectedModel) {
          panel.postMessage({
            type: "chat:error",
            error: "Failed to load the fallback language model. Please check your model configuration or sign in to VS Code.",
          });
          return;
        }
      }

      if (!selectedModel) {
        panel.postMessage({
          type: "chat:error", 
          error: "Failed to load the selected language model.",
        });
        return;
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
        await this.handleAgentMode(selectedModel, composed, panel, abortController);
      } else {
        await this.handleAskMode(selectedModel, composed, panel, abortController);
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

  /**
   * Execute agent mode: stream the model response, parse file modifications, and apply edits.
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
          panel.postMessage({ type: "chat:done", text: aggregatedResponse });
          break;
        }

        if (textParts.length > 0) {
          conversation.push(vscode.LanguageModelChatMessage.Assistant(textParts));
        }

        for (const call of toolCalls) {
          try {
            const resultPart = await this.invokeToolCall(call, panel);
            conversation.push(vscode.LanguageModelChatMessage.Assistant([call]));
            conversation.push(vscode.LanguageModelChatMessage.User([resultPart]));
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
    
    let fullResponse = "";
    
    try {
      const result = await streamLanguageModel(
        selectedModel,
        composed,
        (token: string) => {
          fullResponse += token;
          panel.postMessage({ type: "chat:stream", token });
        },
        abortController.signal
      );
      
      this.currentAbortController = null;
      panel.postMessage({ type: "chat:done", text: result });
    } catch (chatError) {
      this.currentAbortController = null;
      console.error("Error in chat mode:", chatError);
      panel.postMessage({
        type: "chat:error",
        error: chatError instanceof Error ? chatError.message : String(chatError),
      });
    }
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
      }
    | undefined
  > {
    switch (call.name) {
      case "paypilot-createFile": {
        const target = resolveWorkspaceUri((call.input as { path: string }).path);
        const { content, exists } = await this.readFileSnapshot(target);
        return {
          uri: target,
          operation: exists ? "update" : "create",
          originalContent: content,
        };
      }
      case "paypilot-updateFile": {
        const target = resolveWorkspaceUri((call.input as { path: string }).path);
        const { content } = await this.readFileSnapshot(target);
        return {
          uri: target,
          operation: "update",
          originalContent: content,
        };
      }
      case "paypilot-deleteFile": {
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
      default:
        return undefined;
    }
  }

  private async applyToolSideEffects(
    context: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
    },
    call: vscode.LanguageModelToolCallPart,
    result: vscode.LanguageModelToolResult,
    panel: vscode.Webview
  ): Promise<void> {
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
