import * as vscode from "vscode";
import { getAvailableModels } from "../languageModel";

/**
 * Manages language-model related messages flowing between the webview and VS Code APIs.
 */
export class ModelMessageService {
  
  /**
   * Send the list of available VS Code language models to the webview.
   * Called from MessageHandlerService when the webview signals it's ready to receive them.
   * @param panel The webview panel to send the message to.
   * @return Promise that resolves when the operation completes.
   */
  async sendAvailableModels(panel: vscode.Webview): Promise<void> {
    console.log("[PayPilot] Loading available models");
    try {
      const models = await getAvailableModels();
      console.log(`[PayPilot] Successfully loaded ${models.length} models`);
      panel.postMessage({ type: "model:list", models });
    } catch (error) {
      console.error("Error getting available models:", error);
      panel.postMessage({
        type: "chat:error",
        error: "Failed to load available models",
      });
    }
  }

  /**
   * Log model change events from the webview. The next chat request will pick up the new model id.
   * Called from MessageHandlerService when the webview signals a model change.
   * @param msg The message payload from the webview, containing the new model id.
   * @returns Promise that resolves when the operation completes.
   */
  async handleModelChange(msg: any): Promise<void> {
    console.log("Model changed to:", msg.model);
  }
}
