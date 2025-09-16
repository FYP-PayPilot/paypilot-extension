/**
 * Language Model Service - Direct VS Code Language Model API
 * 
 * This service uses the direct VS Code Language Model API:
 * - Uses vscode.lm.selectChatModels() to discover available models
 * - Direct sendRequest calls with proper error handling
 * - Streaming through response.text AsyncIterable for real-time token handling
 */

import * as vscode from 'vscode';
import { ModelInfo } from '../types/chat';

/**
 * Get all available VS Code language models
 * @returns Promise<ModelInfo[]> Array of available models
 */
export async function getAvailableModels(): Promise<ModelInfo[]> {
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
    const models: ModelInfo[] = vscodeModels.map(model => ({
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

/**
 * Stream response from language model with optional real-time callback
 * @param model - The VS Code language model object to use
 * @param prompt - User prompt to send
 * @param onToken - Optional callback for each token received (for UI streaming)
 * @param abortSignal - Optional AbortSignal to cancel the request
 * @returns Promise<string> Complete response text
 */
export async function streamLanguageModel(
  model: vscode.LanguageModelChat,
  prompt: string,
  onToken?: (token: string) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  console.log(`[PayPilot] Using streamLanguageModel with model: ${model.family} (${model.name})`);
  try {
    // Create VS Code cancellation token for clean request termination
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    
    // Check if request was already cancelled before we start
    if (abortSignal?.aborted) {
      cancellationTokenSource.cancel();
      throw new Error('Request was cancelled');
    }
    // Link external abort signal to VS Code cancellation token
    abortSignal?.addEventListener('abort', () => cancellationTokenSource.cancel());

    // Send prompt to language model and get streaming response
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      { justification: 'PayPilot request' },
      cancellationTokenSource.token
    );
    
    console.log(`[PayPilot] API call successful - ${onToken ? 'streaming to UI' : 'collecting full response'}`);
    
    // Accumulate response chunks and track progress
    let fullResponse = '';
    let tokenCount = 0;
    
    // Iterate through streaming response chunks (tokens/words)
    for await (const chunk of response.text) {
      // Exit early if cancellation was requested
      if (cancellationTokenSource.token.isCancellationRequested) {
        break;
      }
      
      // Build complete response from individual chunks
      fullResponse += chunk;
      tokenCount++;
      
      // Send chunk to UI immediately if streaming callback provided
      onToken?.(chunk);
    }

    // Log completion status based on whether request was cancelled
    if (!cancellationTokenSource.token.isCancellationRequested) {
      console.log(`[PayPilot] Complete - ${tokenCount} tokens, ${fullResponse.length} characters`);
    } else {
      console.log(`[PayPilot] Cancelled - partial response with ${tokenCount} tokens`);
    }

    // Clean up cancellation token resources
    cancellationTokenSource.dispose();
    
    // Return complete response text (even if partially cancelled)
    return fullResponse;
    
  } catch (error) {
    // Convert VS Code language model errors to standard Error objects
    if (error instanceof vscode.LanguageModelError) {
      throw new Error(`Language model error: ${error.message}`);
    }
    throw error;
  }
}
