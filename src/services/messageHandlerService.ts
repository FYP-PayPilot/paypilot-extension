import * as vscode from "vscode";
import { DiffService } from "./diff/diffService";
import { getAvailableModels, getLanguageModel, streamLanguageModel } from "./languageModel";
import { FileModificationService } from "./fileModificationService";
import { StatusBarService } from "./statusBarService";
import { McpService } from "./mcpService";
import { ContextService } from "./contextService";

/**
 * Service class for handling all message processing and AI interactions
 */
export class MessageHandlerService {
  private currentAbortController: AbortController | null = null;
  private diffService: DiffService;
  private fileModService: FileModificationService;
  private statusBarService: StatusBarService;
  private mcpService: McpService;
  private contextService: ContextService;

  constructor(workspaceState: vscode.Memento) {
    this.statusBarService = new StatusBarService();
    this.diffService = new DiffService(this.statusBarService, workspaceState);
    this.fileModService = new FileModificationService();
    this.mcpService = new McpService();
    this.contextService = new ContextService();
  }

  /**
   * Handle opening diff view for modified files using the dedicated diff tabs.
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
   * Handle incoming messages from the chat panel
   * @param msg The incoming message object
   * @param panel The webview panel to communicate back to
   * @returns void
   */
  async handleMessage(msg: any, panel: any): Promise<void> {
    const messageType = msg?.type;

    switch (messageType) {
      case "chat:ask":
        await this.handleChatAsk(msg, panel);
        break;
      case "chat:stop":
        await this.handleChatStop(panel);
        break;
      case "chat:new":
        await this.handleNewChat(panel);
        break;
      case "chat:history":
        await this.handleChatHistory(panel);
        break;
      case "model:list-request":
        await this.handleModelListRequest(panel);
        break;
      case "model:change":
        await this.handleModelChange(msg);
        break;
      case "file:open":
        await this.handleFileOpen(msg);
        break;
      case "context:request":
        await this.handleContextRequest(panel);
        break;
      case "context:add":
        await this.handleContextAdd(msg);
        break;
      case "context:remove":
        await this.handleContextRemove(msg);
        break;
      case "context:clear":
        await this.handleContextClear();
        break;
      case "mcp:toggle":
        await this.handleMcpToggle(msg);
        break;
      case "mcp:get":
        await this.handleMcpGet(panel);
        break;
      default:
        console.warn(`[PayPilot] Unknown message type: ${messageType}`);
        break;
    }
  }

  /**
   * Handle chat:ask message
   */
  private async handleChatAsk(msg: any, panel: any): Promise<void> {
    try {
      // Get the specific language model to use
      let selectedModel: vscode.LanguageModelChat | null = null;
      if (msg.model) {
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

      const editor = vscode.window.activeTextEditor;
      const cfg = vscode.workspace.getConfiguration("paypilot");
      const maxContextChars = Math.max(0, Number(cfg.get("maxContextChars")) || 0);

      // Extract editor context for AI prompt
      let editorContext = "";
      if (editor && maxContextChars > 0) {
        const fullText = editor.document.getText();
        if (fullText.length <= maxContextChars) {
          editorContext = fullText;
        } else {
          const selection = editor.selection;
          if (!selection.isEmpty) {
            editorContext = editor.document.getText(selection);
          } else {
            const cursorPosition = selection.active;
            const lineNumber = cursorPosition.line;
            const totalLines = editor.document.lineCount;

            const contextRadius = Math.floor(maxContextChars / 80);
            const startLine = Math.max(0, lineNumber - contextRadius);
            const endLine = Math.min(totalLines - 1, lineNumber + contextRadius);

            const contextRange = new vscode.Range(
              startLine, 0, endLine, editor.document.lineAt(endLine).text.length
            );
            editorContext = editor.document.getText(contextRange);
          }
        }
      }

      // Build context files content
      let contextFilesContent = "";
      if (msg.contextFiles && msg.contextFiles.length > 0) {
        // Add context files to context service
        await this.contextService.addFilesToContext(
          msg.contextFiles.map((f: any) => f.filePath)
        );
        contextFilesContent = this.contextService.buildContextContent();
      }

      const mode = msg.mode || "ask";

      // Compose the prompt based on mode (agent vs ask)
      let composed = "";
      if (mode === "agent") {
        composed = this.composeAgentPrompt(msg, editorContext, contextFilesContent);
      } else {
        composed = this.composeAskPrompt(msg, editorContext, contextFilesContent);
      }

      // Store the current request for potential cancellation
      const abortController = new AbortController();
      this.currentAbortController = abortController;

      if (mode === "agent") {
        await this.handleAgentMode(selectedModel, composed, msg, panel, abortController);
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
   * Compose prompt for agent mode
   */
  private composeAgentPrompt(msg: any, editorContext: string, contextFilesContent: string): string {
    return [
      "You are an AI coding assistant. Analyze the user's request and the provided code context.",
      "Your task is to make the requested changes to the code.",
      contextFilesContent
        ? "IMPORTANT: Multiple files are provided in context. If the user requests changes to multiple files, provide separate responses for each file."
        : "",
      "For each file you modify, respond with:",
      "1. File: [specify the exact filename you are modifying]",
      "2. Summary: [Brief description of changes]",
      "3. The complete modified file content wrapped in a code block",
      "",
      "Format your response like this:",
      "File: [filename]",
      "Summary: [Brief description of changes]",
      "",
      "```[language]",
      "[complete code]",
      "```",
      "",
      "If modifying multiple files, repeat the above format for each file.",
      "",
      editorContext ? "--- Current file context ---" : "",
      editorContext || "",
      editorContext ? "--- End of current file context ---" : "",
      "",
      contextFilesContent,
      "User request:",
      msg.prompt,
    ].filter((line) => line !== "").join("\n");
  }

  /**
   * Compose prompt for ask mode
   */
  private composeAskPrompt(msg: any, editorContext: string, contextFilesContent: string): string {
    return [
      "You are an AI assistant helping with coding questions.",
      "If you provide code, wrap it in code blocks with appropriate language identifiers.",
      "",
      editorContext ? "--- Current file context ---" : "",
      editorContext || "",
      editorContext ? "--- End of current file context ---" : "",
      "",
      contextFilesContent,
      "User question:",
      msg.prompt,
    ].filter((line) => line !== "").join("\n");
  }

  /**
   * Handle agent mode processing
   */
  private async handleAgentMode(
    selectedModel: vscode.LanguageModelChat,
    composed: string,
    msg: any,
    panel: any,
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
      const fileModifications = this.fileModService.parseMultipleFileModifications(
        fullResponse, 
        msg.contextFiles || []
      );
      
      console.log(`[PayPilot] Found ${fileModifications.length} file modifications`);

      if (fileModifications.length === 0) {
        panel.postMessage({ type: "chat:done", text: fullResponse });
      } else {
        await this.processFileModifications(fileModifications, panel);
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
   * Handle ask mode processing
   */
  private async handleAskMode(
    selectedModel: vscode.LanguageModelChat,
    composed: string,
    panel: any,
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
   * Apply AI-generated file modifications and hand them over to the diff service.
   */
  private async processFileModifications(fileModifications: any[], panel: any): Promise<void> {
    const sortedModifications = this.fileModService.sortModificationsByDependency(fileModifications);
    const backups = await this.fileModService.createBackups(sortedModifications);

    const diffEntries: Array<{ filePath: string; originalContent: string }> = [];
    const modifiedFileNames: string[] = [];

    for (const modification of sortedModifications) {
      try {
        const uri = vscode.Uri.file(modification.filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const originalContent = document.getText();
        const originalLines = originalContent.split("\n");
        const newLines = modification.content.split("\n");
        const diffStats = this.diffService.calculateDiffStats(originalLines, newLines);

        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(originalContent.length)
        );
        edit.replace(uri, fullRange, modification.content);

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
          throw new Error(`Unable to apply edits for ${modification.fileName}`);
        }
        await document.save();

        diffEntries.push({
          filePath: modification.filePath,
          originalContent,
        });
        modifiedFileNames.push(modification.fileName);

        panel.postMessage({
          type: "chat:code-applied",
          fileName: modification.fileName,
          filePath: modification.filePath,
          linesAdded: diffStats.added,
          linesDeleted: diffStats.deleted,
          explanation: modification.summary || `Updated ${modification.fileName}`,
        });
      } catch (error) {
        console.error(`[PayPilot] Error applying ${modification.fileName}:`, error);
        if (backups.size > 0) {
          await this.fileModService.restoreFromBackups(backups);
        }
        panel.postMessage({
          type: "chat:error",
          error: `Failed to modify ${modification.fileName}: ${error}`
        });
        return;
      }
    }

    if (diffEntries.length > 0) {
      await this.diffService.trackModifiedFiles(diffEntries);
      const message = diffEntries.length === 1
        ? `Review started for ${modifiedFileNames[0]}`
        : `Review started for ${diffEntries.length} files`;
      this.statusBarService.showTemporaryMessage(message, 3000);
    }
  }
  /**
   * Handle chat:stop message
   */
  private async handleChatStop(panel: any): Promise<void> {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
      panel.postMessage({ type: "chat:stopped" });
    }
  }

  /**
   * Handle chat:new message - placeholder for now
   */
  private async handleNewChat(panel: any): Promise<void> {
    console.log("[PayPilot] New chat requested");
    // TODO: Implement chat session management
    panel.postMessage({
      type: "chat:new-response",
      success: true,
    });
  }

  /**
   * Handle chat:history message - placeholder for now
   */
  private async handleChatHistory(panel: any): Promise<void> {
    console.log("[PayPilot] Chat history requested");
    // TODO: Implement chat history retrieval
    panel.postMessage({
      type: "chat:history-response",
      sessions: [], // Empty for now
    });
  }

  /**
   * Handle model:list-request message
   */
  private async handleModelListRequest(panel: any): Promise<void> {
    console.log("[PayPilot] Loading available models");
    try {
      const models = await getAvailableModels();
      console.log(`[PayPilot] Successfully loaded ${models.length} models`);
      panel.postMessage({
        type: "model:list",
        models,
      });
    } catch (error) {
      console.error("Error getting available models:", error);
      panel.postMessage({
        type: "chat:error",
        error: "Failed to load available models",
      });
    }
  }

  /**
   * Handle model:change message
   */
  private async handleModelChange(msg: any): Promise<void> {
    console.log("Model changed to:", msg.model);
    // The model will be used in the next chat:ask
  }

  /**
   * Handle file:open message
   */
  private async handleFileOpen(msg: any): Promise<void> {
    try {
      const uri = vscode.Uri.file(msg.filePath);
      await vscode.window.showTextDocument(uri);
    } catch (error) {
      console.error("Error opening file:", error);
      vscode.window.showErrorMessage(`Failed to open file: ${msg.filePath}`);
    }
  }

  /**
   * Handle context:request message
   */
  private async handleContextRequest(panel: any): Promise<void> {
    try {
      const contextFiles = await this.contextService.requestContextFiles();
      
      if (contextFiles.length > 0) {
        panel.postMessage({
          type: "context:add",
          files: contextFiles,
        });
      }
    } catch (error) {
      console.error("Error in context request:", error);
      panel.postMessage({
        type: "chat:error",
        error: "Failed to request context files",
      });
    }
  }

  /**
   * Handle context:add message
   */
  private async handleContextAdd(msg: any): Promise<void> {
    if (msg.filePaths && Array.isArray(msg.filePaths)) {
      await this.contextService.addFilesToContext(msg.filePaths);
      console.log("Added files to context:", msg.filePaths);
    }
  }

  /**
   * Handle context:remove message
   */
  private async handleContextRemove(msg: any): Promise<void> {
    if (msg.filePath) {
      this.contextService.removeFileFromContext(msg.filePath);
      console.log("Removed file from context:", msg.filePath);
    }
  }

  /**
   * Handle context:clear message
   */
  private async handleContextClear(): Promise<void> {
    this.contextService.clearAllContext();
    console.log("Cleared all context files");
  }

  /**
   * Handle mcp:toggle message
   */
  private async handleMcpToggle(msg: any): Promise<void> {
    this.mcpService.setEnabled(msg.enabled);
  }

  /**
   * Handle mcp:get message
   */
  private async handleMcpGet(panel: any): Promise<void> {
    try {
      const servers = this.mcpService.getMcpServers();
      panel.postMessage({
        type: "mcp:servers",
        servers: servers
      });
    } catch (error) {
      console.error("Error getting MCP servers:", error);
      panel.postMessage({
        type: "chat:error",
        error: "Failed to load MCP servers"
      });
    }
  }

  /**
   * Set chat panel visibility (called from extension.ts)
   */
  setChatPanelVisibility(visible: boolean): void {
    this.statusBarService.setChatPanelVisibility(visible);
    
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
   * Get diff service instance (now includes sequential functionality)
   */
  getDiffService(): DiffService {
    return this.diffService;
  }

  /**
   * Get MCP service instance  
   */
  getMcpService(): McpService {
    return this.mcpService;
  }

  /**
   * Clean up all services
   */
  dispose(): void {
    this.statusBarService.dispose();
    this.diffService.dispose(); // Now handles both regular and sequential cleanup
    this.contextService.clearAllContext();
    this.mcpService.reset();
    
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    
    console.log("[PayPilot] MessageHandlerService disposed");
  }
}
