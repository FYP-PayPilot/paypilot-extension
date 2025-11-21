import * as vscode from "vscode";
import { getBackendModels } from "../../infrastructure/vscode_http_client";
import { getVSCodeModels } from './languageModelService';

/**
 * Manages language-model related messages flowing between the webview and VS Code APIs.
 * Now uses FastAPI backend for model discovery.
 */
export class ModelMessageService {

  /**
   * Log model change events from the webview. The next chat request will pick up the new model id.
   * Called from MessageHandlerService when the webview signals a model change.
   * @param msg The message payload from the webview, containing the new model id.
   * @returns Promise that resolves when the operation completes.
   */
  async handleModelChange(msg: any): Promise<void> {
    console.log("Model changed to:", msg.model);
  }

  async sendAvailableModels(panel: vscode.Webview): Promise<void> {
    try {
      console.log('[PayPilot] Loading models from both VS Code and backend...');
      
      // Load both VS Code models and backend models in parallel
      const [vscodeModels, backendModels] = await Promise.all([
        getVSCodeModels(),
        getBackendModels()
      ]);

      // Tag models with their source
      const taggedVSCodeModels = vscodeModels.map(model => ({
        ...model,
        source: 'vscode' as const,
        description: `${model.description || 'VS Code model'} (Agent mode only)`
      }));

      const taggedBackendModels = backendModels.map(model => ({
        ...model,
        source: 'backend' as const,
        description: `${model.description || 'Backend model'} (Ask mode only)`
      }));

      // Combine and sort models
      const allModels = [...taggedVSCodeModels, ...taggedBackendModels]
        .sort((a, b) => a.name.localeCompare(b.name));

      console.log(`[PayPilot] Total models loaded: ${allModels.length} (${vscodeModels.length} VS Code, ${backendModels.length} backend)`);

      panel.postMessage({ type: "model:list", models: allModels });
    } catch (error) {
      console.error('[PayPilot] Error loading models:', error);
      panel.postMessage({
        type: "chat:error",
        error: "Failed to load available models from backend. Is the FastAPI server running?",
      });
    }
  }
}
