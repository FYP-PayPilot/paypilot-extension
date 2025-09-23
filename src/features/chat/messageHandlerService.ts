import * as vscode from "vscode";
import { DiffService } from "../diff/diffService";
import { getAvailableModels, getLanguageModel, streamLanguageModel } from "../language-model/languageModelService";
import { FileModificationService } from "../file-modification/fileModificationService";
import { StatusBarService } from "../diff/statusBarService";
import { McpService } from "../mcp/mcpService";
import { ContextService } from "../context/contextService";
import { PromptService } from "./promptService";
import { ContextMessageService } from "../context/contextMessageService";
import { McpMessageService } from "../mcp/mcpMessageService";
import { ModelMessageService } from "../language-model/modelMessageService";
import { ChatHistoryService } from "./chatHistoryService";
import { ChatMessage } from "../../types/chat";

/**
 * Orchestrates chat requests, AI responses, diff tracking, context management, MCP configuration and chat management. 
 * Acts as the bridge between the webview and backend services.
 */
export class MessageHandlerService {
  private currentAbortController: AbortController | null = null;
  private readonly diffService: DiffService;
  private readonly fileModService: FileModificationService;
  private readonly statusBarService: StatusBarService;
  private readonly mcpService: McpService;
  private readonly contextService: ContextService;
  private readonly promptService: PromptService;
  private readonly contextMessageService: ContextMessageService;
  private readonly mcpMessageService: McpMessageService;
  private readonly modelMessageService: ModelMessageService;
  private readonly chatHistoryService: ChatHistoryService;

  constructor(workspaceState: vscode.Memento) {
    this.statusBarService = new StatusBarService();
    this.diffService = new DiffService(this.statusBarService, workspaceState);
    this.fileModService = new FileModificationService();
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
        await this.contextMessageService.addFiles(message?.filePaths);
        break;
      case "context:remove":
        this.contextMessageService.removeFile(message?.filePath);
        break;
      case "context:clear":
        this.contextMessageService.clearAll();
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

    try {
      const fullResponse = await streamLanguageModel(
        selectedModel,
        composed,
        undefined,
        abortController.signal
      );

      this.currentAbortController = null;

      // Parse multiple file modifications from AI response
      const contextFiles = this.contextService.getContextFiles();
      const fileModifications = this.fileModService.parseMultipleFileModifications(
        fullResponse,
        contextFiles
      );
      
      console.log(`[PayPilot] Found ${fileModifications.length} file modifications`);

      if (fileModifications.length === 0) {
        panel.postMessage({ type: "chat:done", text: fullResponse });
      } else {
        await this.fileModService.applyModifications(fileModifications, this.diffService, panel);
      }
    } catch (agentError) {
      this.currentAbortController = null;
      console.error("Error in agent mode:", agentError);
      panel.postMessage({
        type: "chat:error",
        error: agentError instanceof Error ? agentError.message : String(agentError),
      });
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
