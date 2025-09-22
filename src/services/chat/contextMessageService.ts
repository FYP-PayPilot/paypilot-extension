import * as vscode from "vscode";
import { ContextService } from "../contextService";

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
   * Add specific file paths to the context store.
   * Called from MessageHandlerService when the webview sends file paths to add.
   * @param filePaths Array of file paths to add to context.
   * @returns Promise that resolves when the operation completes.
   */
  async addFiles(filePaths?: string[]): Promise<void> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return;
    }
    await this.contextService.addFilesToContext(filePaths);
    console.log("Added files to context:", filePaths);
  }

  /**
   * Remove a single context file by path.
   * Called from MessageHandlerService when the webview sends a file path to remove.
   * @param filePath The file path to remove from context.
   */
  removeFile(filePath?: string): void {
    if (!filePath) {
      return;
    }
    this.contextService.removeFileFromContext(filePath);
    console.log("Removed file from context:", filePath);
  }

  /**
   * Clear all context files from the current session.
   * Called from MessageHandlerService when the webview signals a clear request.
   * @returns void
   */
  clearAll(): void {
    this.contextService.clearAllContext();
    console.log("Cleared all context files");
  }
}
