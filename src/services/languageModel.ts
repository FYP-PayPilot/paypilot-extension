import * as vscode from 'vscode';
import { ModelInfo } from '../types/chat';

/**
 * Language Model Service - Direct VS Code Language Model API
 * 
 * This service uses the direct VS Code Language Model API:
 * - Uses vscode.lm.selectChatModels() to discover available models
 * - Direct sendRequest calls with proper error handling
 * - Native streaming through response.text AsyncIterable
 * - Simplified, maintainable code following VS Code best practices
 */

/**
 * Get all available VS Code language models
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

    // Convert VS Code model objects to our standardized ModelInfo format
    // This is needed because:
    // 1. Our React UI expects the ModelInfo interface structure
    // 2. VS Code models have different property names/organization
    // 3. We want consistent model representation across the extension
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
 * Stream chat response from language model - Agent Mode (no UI streaming)
 * Collects full response before processing
 */
export async function streamChatAgent(
  modelId: string,
  prompt: string,
  abortSignal?: AbortSignal
): Promise<string> {
  console.log(`[PayPilot] 🚀 Using NEW DIRECT API - streamChatAgent with model: ${modelId}`);
  try {
    const models = await vscode.lm.selectChatModels();
    const selectedModel = models.find(m => m.family === modelId || m.id === modelId) || models[0];
    
    if (!selectedModel) {
      throw new Error(`No language model found. Available: ${models.map(m => m.family).join(', ')}`);
    }

    console.log(`[PayPilot] Selected model for agent mode: ${selectedModel.family} (${selectedModel.name})`);

    const cancellationTokenSource = new vscode.CancellationTokenSource();
    
    // Handle abort signal
    if (abortSignal?.aborted) {
      cancellationTokenSource.cancel();
      throw new Error('Request was cancelled');
    }
    abortSignal?.addEventListener('abort', () => cancellationTokenSource.cancel());

    const response = await selectedModel.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      { justification: 'PayPilot agent mode request' },
      cancellationTokenSource.token
    );
    
    console.log(`[PayPilot] ✅ Direct API call successful - collecting full response in agent mode`);
    
    let fullResponse = '';
    for await (const chunk of response.text) {
      if (cancellationTokenSource.token.isCancellationRequested) {
        throw new Error('Request was cancelled');
      }
      fullResponse += chunk;
    }

    console.log(`[PayPilot] ✅ Agent mode complete - collected ${fullResponse.length} characters`);

    cancellationTokenSource.dispose();
    return fullResponse;
    
  } catch (error) {
    if (error instanceof vscode.LanguageModelError) {
      throw new Error(`Language model error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Stream chat response from language model - Chat Mode (with UI streaming)
 * Streams tokens in real-time to the provided callback
 */
export async function streamChatUI(
  modelId: string,
  prompt: string,
  onToken: (token: string) => void,
  onComplete: (fullText: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  console.log(`[PayPilot] 🚀 Using NEW DIRECT API - streamChatUI with model: ${modelId}`);
  try {
    const models = await vscode.lm.selectChatModels();
    const selectedModel = models.find(m => m.family === modelId || m.id === modelId) || models[0];
    
    if (!selectedModel) {
      throw new Error(`No language model found. Available: ${models.map(m => m.family).join(', ')}`);
    }

    console.log(`[PayPilot] Selected model for chat mode: ${selectedModel.family} (${selectedModel.name})`);

    const cancellationTokenSource = new vscode.CancellationTokenSource();
    
    // Handle abort signal
    if (abortSignal?.aborted) {
      cancellationTokenSource.cancel();
      return;
    }
    abortSignal?.addEventListener('abort', () => cancellationTokenSource.cancel());

    const response = await selectedModel.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      { justification: 'PayPilot chat streaming request' },
      cancellationTokenSource.token
    );
    
    console.log(`[PayPilot] ✅ Direct API call successful - streaming tokens to UI in chat mode`);
    
    let fullResponse = '';
    let tokenCount = 0;
    for await (const chunk of response.text) {
      if (cancellationTokenSource.token.isCancellationRequested) {
        break;
      }
      fullResponse += chunk;
      tokenCount++;
      onToken(chunk);
    }

    if (!cancellationTokenSource.token.isCancellationRequested) {
      console.log(`[PayPilot] ✅ Chat mode complete - streamed ${tokenCount} tokens, total ${fullResponse.length} characters`);
      onComplete(fullResponse);
    } else {
      console.log(`[PayPilot] ⚠️ Chat mode cancelled - partial response with ${tokenCount} tokens`);
    }

    cancellationTokenSource.dispose();
    
  } catch (error) {
    if (error instanceof vscode.LanguageModelError) {
      throw new Error(`Language model error: ${error.message}`);
    }
    throw error;
  }
}
