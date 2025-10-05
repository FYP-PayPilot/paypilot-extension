/**
 * Language Model Service - VS Code Language Model API
 * - Uses vscode.lm.selectChatModels() to discover available models
 * - Direct sendRequest calls with proper error handling
 */

import * as vscode from "vscode";
import { ModelInfo } from "../../types/chat";

const BACKEND_URL = "http://localhost:8000";

/**
 * Get all available language models from the backend server
 * @returns Promise<ModelInfo[]> Array of available models
 */
export async function getAvailableModels(): Promise<ModelInfo[]> {
  try {
    console.log("[PayPilot] Loading available language models from backend...");

    const response = await fetch(`${BACKEND_URL}/models`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      throw new Error(
        `Backend returned ${response.status}: ${response.statusText}`
      );
    }

    const models: ModelInfo[] = await response.json();

    console.log(
      `[PayPilot] Successfully loaded ${models.length} models from backend`
    );
    console.log(
      "[PayPilot] Available models:",
      models.map((m) => m.id)
    );

    return models.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("[PayPilot] Failed to load models from backend:", error);

    // Show user-friendly error
    if (error instanceof Error) {
      if (error.message.includes("fetch")) {
        vscode.window.showWarningMessage(
          "PayPilot: Cannot connect to backend server."
        );
      } else {
        vscode.window.showWarningMessage(
          `PayPilot: Failed to load models: ${error.message}`
        );
      }
    }

    return [];
  }
}

/**
 * Get model information by ID from the backend
 * @param modelId - The model ID to find
 * @returns The model info or null if not found
 */
export async function getModelInfo(modelId: string): Promise<ModelInfo | null> {
  try {
    const models = await getAvailableModels();
    return models.find((m) => m.id === modelId) || null;
  } catch (error) {
    console.warn("[PayPilot] Failed to get model info:", error);
    return null;
  }
}

/**
 * Check if the backend server is reachable
 * @returns Promise<boolean>
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch (error) {
    console.warn("[PayPilot] Backend health check failed:", error);
    return false;
  }
}

/**
 * Get a specific language model by ID
 * @param modelId - The model ID or family to find
 * @returns The VS Code language model object or null if not found
 */
export async function getLanguageModel(
  modelId: string
): Promise<vscode.LanguageModelChat | null> {
  try {
    const models = await vscode.lm.selectChatModels();
    return models.find((m) => m.family === modelId || m.id === modelId) || null;
  } catch (error) {
    console.warn("[PayPilot] Failed to get language model:", error);
    return null;
  }
}
