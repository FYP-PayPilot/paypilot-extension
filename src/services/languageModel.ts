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
 * Get all available VS Code language models
 * 
 * This function automatically requests user consent and discovers available models.
 * It's designed to be called when user interacts with the model dropdown.
 * 
 * @param context VS Code extension context (kept for consistency)
 * @returns Promise<ModelInfo[]> Array of available VS Code models
 */
export async function getAvailableModels(context: vscode.ExtensionContext): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];

  try {
    // Auto-request user consent and discover models
    console.log('[PayPilot] Auto-requesting user consent for language models...');
    const vscodeModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    console.log('[PayPilot] Models discovered:', vscodeModels.map(m => ({ id: m.id, family: m.family, name: m.name })));

    if (vscodeModels.length === 0) {
      console.warn('[PayPilot] No VS Code language models available. User may need to enable Copilot or sign in.');
      return [];
    }
    
    for (const model of vscodeModels) {
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
    // Select model with user consent - this should trigger the consent popup
    console.log('[PayPilot] Requesting user consent for language models...');
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    console.log('[PayPilot] User consent granted. Available models:', allModels.map(m => ({ id: m.id, family: m.family, name: m.name })));
    
    // Find model by family or ID
    const selectedModel = allModels.find(m => m.family === modelId) ||
                         allModels.find(m => m.id === modelId) ||
                         allModels[0]; // Use first available as fallback
    
    if (!selectedModel) {
      throw new Error(`No language model found. Available: ${allModels.map(m => m.family).join(', ')}`);
    }

    console.log('[PayPilot] Using model:', { id: selectedModel.id, family: selectedModel.family, name: selectedModel.name });

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
