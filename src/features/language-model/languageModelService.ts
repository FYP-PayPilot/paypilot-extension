/**
 * Language Model Service - VS Code Language Model API
 * - Uses vscode.lm.selectChatModels() to discover available models
 * - Direct sendRequest calls with proper error handling
 */

import * as vscode from "vscode";
import { ModelInfo } from "./types";

/**
 * Get all available VS Code language models
 * @returns Promise<ModelInfo[]> Array of available models
 */
const SUPPORTED_VSCODE_FAMILIES = new Set([
  "gpt-4o",
  "gpt-4o-mini",
  "o1",
  "o1-mini",
  "claude-3-5-sonnet",
  "grok-code",
  "gpt-3.5-turbo",
  "gpt-4.1",
  "gpt-5-mini",
]);

export async function getVSCodeModels(): Promise<ModelInfo[]> {
  try {
    console.log('[PayPilot] Loading available language models...');
    
    const vscodeModels = await vscode.lm.selectChatModels();
    console.log(`[PayPilot] Models discovered: (${vscodeModels.length})`, 
      vscodeModels.map(m => ({ id: m.id, family: m.family, name: m.name, vendor: m.vendor })));

    if (vscodeModels.length === 0) {
      console.warn('[PayPilot] No VS Code language models available.');
      return [];
    }

    // Convert VS Code model objects to ModelInfo format which the React UI expects
    const models: ModelInfo[] = vscodeModels
      .filter((model) => SUPPORTED_VSCODE_FAMILIES.has(model.family ?? ""))
      .map(model => ({
        id: model.id,
        name: model.name || model.family || 'Unknown Model',
        vendor: model.vendor,
        family: model.family,
        version: model.version,
        maxTokens: model.maxInputTokens,
        description: `VS Code language model (${model.vendor})`,
        isExternal: false
      }));

    return models.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.warn('[PayPilot] Failed to load VS Code language models:', error);
    
    if (error instanceof vscode.LanguageModelError) {
      console.warn(`[PayPilot] Language Model Error: ${error.message} (code: ${error.code})`);
    }
    
    return [];
  }
}

/**
 * Get a specific language model by ID
 * @param modelId - The model ID or family to find
 * @returns The VS Code language model object or null if not found
 */
export async function getLanguageModel(modelId: string): Promise<vscode.LanguageModelChat | null> {
  try {
    const models = await vscode.lm.selectChatModels();
    return models.find(m => m.family === modelId || m.id === modelId) || null;
  } catch (error) {
    console.warn('[PayPilot] Failed to get language model:', error);
    return null;
  }
}
