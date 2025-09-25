import * as vscode from "vscode";
import { ContextService } from "./contextService";

/**
 * Bridges context-related webview messages with the underlying ContextService.
 */
export class ContextMessageService {
  constructor(private readonly contextService: ContextService) {}

  /**
   * Prompt the user for additional context files and notify the webview.
   * Called from MessageHandlerService when the webview signals a context request.
   * @param panel The webview panel to send the message to.
   * @returns Promise that resolves when the operation completes.
   */
  async respondToContextRequest(panel: vscode.Webview): Promise<void> {
    try {
      const contextFiles = await this.contextService.requestContextFiles();
      if (contextFiles.length > 0) {
        panel.postMessage({ type: "context:add", files: contextFiles });
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
   * Emit the latest context file list to the chat panel so the UI stays in sync.
   */
  private postContextSnapshot(panel: vscode.Webview): void {
    panel.postMessage({
      type: "context:list",
      files: this.contextService.getContextFiles(),
    });
  }


  /**
   * Add specific file paths to the context store.
   * Called from MessageHandlerService when the webview sends file paths to add.
   * When a panel is supplied we broadcast the refreshed list so the UI stays current.
   * @param filePaths Array of file paths to add to context.
   * @param panel Optional chat webview to publish the updated context list.
   */
  async addFiles(filePaths?: string[], panel?: vscode.Webview): Promise<void> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return;
    }
    await this.contextService.addFilesToContext(filePaths);
    console.log('[PayPilot] Added files to context:', filePaths);

    if (panel) {
      this.postContextSnapshot(panel);
    }
  }

  /**
   * Remove a single context file by path.
   * Called from MessageHandlerService when the webview sends a file path to remove.
   * @param filePath The file path to remove from context.
   * @param panel Optional chat webview to publish the updated context list.
   */
  removeFile(filePath?: string, panel?: vscode.Webview): void {
    if (!filePath) {
      return;
    }
    const removed = this.contextService.removeFileFromContext(filePath);
    if (removed) {
      console.log('[PayPilot] Removed file from context:', filePath);
      if (panel) {
        this.postContextSnapshot(panel);
      }
    }
  }

  /**
   * Convenience helper used by automated workflows (e.g. AI-driven deletes).
   * Strips the file from context and notifies the panel when a removal occurred.
   */
  handleExternalRemoval(filePath: string, panel: vscode.Webview): void {
    this.removeFile(filePath, panel);
  }

  /**
   * Clear all context files from the current session.
   * @param panel Optional chat webview to publish the updated (empty) context list.
   */
  clearAll(panel?: vscode.Webview): void {
    this.contextService.clearAllContext();
    console.log('[PayPilot] Cleared all context files');

    if (panel) {
      this.postContextSnapshot(panel);
    }
  }
}
