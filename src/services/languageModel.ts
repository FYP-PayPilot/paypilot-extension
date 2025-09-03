import * as vscode from 'vscode';
import { ModelInfo } from '../types/chat';

/**
 * Language Model Service - VS Code Language Model API
 * 
 * This service strictly follows the VS Code Language Model API documentation:
 * - Uses vscode.lm.selectChatModels() to discover available models
 * - Creates prompts with LanguageModelChatMessage.User()
 * - Handles streaming responses through response.text AsyncIterable
 * - Implements proper error handling with LanguageModelError
 * - Provides defensive programming for model availability
 * 
 * Focuses exclusively on VS Code built-in models for better integration and user experience.
 */

export interface LanguageModelRequest {
  modelId: string;
  prompt: string;
  abortSignal?: AbortSignal;
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: unknown) => void;
}

/**
 * Get all available VS Code language models - auto-loads without user interaction
 * 
 * This function automatically discovers available models without requiring user consent.
 * It filters to only include the models we want to support.
 * 
 * @param context VS Code extension context (kept for consistency)
 * @returns Promise<ModelInfo[]> Array of filtered VS Code models
 */
export async function getAvailableModels(context: vscode.ExtensionContext): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];

  try {
    // Auto-discover all available models
    console.log('[PayPilot] Auto-loading available language models...');
    
    // Try to get all available models without vendor restriction
    let vscodeModels = await vscode.lm.selectChatModels();
    
    console.log(`[PayPilot] Models discovered: (${vscodeModels.length})`, vscodeModels.map(m => ({ id: m.id, family: m.family, name: m.name, vendor: m.vendor })));

    if (vscodeModels.length === 0) {
      console.warn('[PayPilot] No VS Code language models available.');
      return [];
    }

    // Filter to only the models we want to support (based on actual VS Code models)
    const allowedModelIds = [
      'gpt-4.1',           // GPT-4.1
      'gpt-4',             // GPT 4  
      'gpt-4o',            // GPT-4o
      'o3-mini',           // o3-mini
      'claude-sonnet-4'    // Claude Sonnet 4
    ];
    
    for (const model of vscodeModels) {
      // Only include models that are in our allowed list
      if (!allowedModelIds.includes(model.id)) {
        continue;
      }

      const displayName = model.name || model.family || 'Unknown Model';

      models.push({
        id: model.id,
        name: displayName,
        vendor: model.vendor,
        family: model.family,
        version: model.version,
        maxTokens: model.maxInputTokens,
        description: `VS Code built-in model (${model.vendor})`,
        isExternal: false
      });
    }
  } catch (error) {
    console.warn('[PayPilot] Failed to load VS Code language models:', error);
    
    if (error instanceof vscode.LanguageModelError) {
      console.warn(`[PayPilot] Language Model Error: ${error.message} (code: ${error.code})`);
    }
    
    return [];
  }

  // Sort models alphabetically for consistent UI
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

/**
 * Send request to the specified VS Code language model
 */
export async function sendLanguageModelRequest(
  request: LanguageModelRequest,
  context: vscode.ExtensionContext
): Promise<void> {
  const { modelId, prompt, abortSignal, onToken, onDone, onError } = request;
  let fullResponse = '';
  let cancellationTokenSource: vscode.CancellationTokenSource | undefined;

  try {
    // Get available models (auto-consent already handled)
    const allModels = await vscode.lm.selectChatModels();
    
    // Find model by family or ID
    const selectedModel = allModels.find(m => m.family === modelId) ||
                         allModels.find(m => m.id === modelId) ||
                         allModels[0]; // Use first available as fallback
    
    if (!selectedModel) {
      throw new Error(`No language model found. Available: ${allModels.map(m => m.family).join(', ')}`);
    }

    // Setup cancellation
    cancellationTokenSource = new vscode.CancellationTokenSource();
    if (abortSignal?.aborted) {
      cancellationTokenSource.cancel();
      return;
    }
    abortSignal?.addEventListener('abort', () => cancellationTokenSource?.cancel());

    // Send request
    const response = await selectedModel.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      { justification: 'PayPilot extension language model request' },
      cancellationTokenSource.token
    );
    
    // Stream response
    for await (const chunk of response.text) {
      if (cancellationTokenSource.token.isCancellationRequested) {
        break;
      }
      fullResponse += chunk;
      onToken(chunk);
    }

    if (!cancellationTokenSource.token.isCancellationRequested) {
      onDone(fullResponse);
    }
    
  } catch (error) {
    if (error instanceof vscode.LanguageModelError) {
      onError(new Error(`Language model error: ${error.message}`));
    } else {
      onError(error);
    }
  } finally {
    cancellationTokenSource?.dispose();
  }
}
