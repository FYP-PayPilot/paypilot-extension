import { ModelInfo } from '../features/language-model/types';

/**
 * Language Model Service - FastAPI Server Client
 * 
 * This service routes requests through a FastAPI server instead of 
 * using the VS Code Language Model API directly.
 */

// Configuration - Production backend
const FASTAPI_BASE_URL = 'http://209.38.58.134:8000';
const TIMEOUT_MS = 30000;

/**
 * Get all available language models from FastAPI server
 */
export async function getBackendModels(): Promise<ModelInfo[]> {
  try {
    console.log('[PayPilot] Loading available language models from FastAPI server...');
    
    const response = await fetch(`${FASTAPI_BASE_URL}/models`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`FastAPI server error: ${response.status} ${response.statusText}`);
    }

    const models: ModelInfo[] = await response.json();
    console.log(`[PayPilot] Models received from server: (${models.length})`, 
      models.map(m => ({ id: m.id, name: m.name, vendor: m.vendor })));

    return models.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.warn('[PayPilot] Failed to load language models from FastAPI server:', error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.warn('[PayPilot] Network error - is the FastAPI server running?');
    }
    
    return [];
  }
}

/**
 * Stream chat response from FastAPI server - Agent Mode (no UI streaming)
 * Collects full response before processing
 */
export async function getChatAgent(
  modelId: string,
  userPrompt: string,
  fileContext: string,
  editorContext: string,
  workspaceRoot?: string,
  abortSignal?: AbortSignal
): Promise<string> {
  console.log(`[PayPilot] Using getChatAgent via FastAPI with model: ${modelId}`);
  
  try {
    const controller = new AbortController();
    
    // Handle external abort signal
    if (abortSignal?.aborted) {
      throw new Error('Request was cancelled');
    }
    abortSignal?.addEventListener('abort', () => controller.abort());

    const response = await fetch(`${FASTAPI_BASE_URL}/chat/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: modelId,
        user_prompt: userPrompt,
        file_context: fileContext,
        editor_context: editorContext,
        workspace_root: workspaceRoot ?? null
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FastAPI server error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`[PayPilot] ✅ Agent mode complete via FastAPI - received ${result.response.length} characters`);
    console.log(`[PayPilot] ✅ Agent mode complete via FastAPI - tokens used ${result.response.tokens_used}`);
    
    return result.response;
    
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request was cancelled');
    }
    console.error('[PayPilot] FastAPI agent request failed:', error);
    throw error;
  }
}

/**
 * Stream chat response from FastAPI server - Chat Mode (with UI streaming)
 * Streams tokens in real-time to the provided callback
 */
export async function streamChatUI(
  modelId: string,
  userPrompt: string,
  fileContext: string,
  editorContext: string,
  onToken: (token: string) => void,
  onComplete: (fullText: string) => void,
  workspaceRoot?: string,
  abortSignal?: AbortSignal
): Promise<void> {
  console.log(`[PayPilot] 🚀 Using FastAPI streaming - streamChatUI with model: ${modelId}`);
  
  try {
    const controller = new AbortController();
    
    // Handle external abort signal
    if (abortSignal?.aborted) {
      return;
    }
    abortSignal?.addEventListener('abort', () => controller.abort());

    const response = await fetch(`${FASTAPI_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: modelId,
        user_prompt: userPrompt,
        file_context: fileContext,
        editor_context: editorContext,
        workspace_root: workspaceRoot ?? null
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FastAPI server error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    console.log(`[PayPilot] ✅ FastAPI streaming connection established`);
    
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body available for streaming');
    }

    const decoder = new TextDecoder();
    let fullResponse = '';
    let tokenCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done || controller.signal.aborted) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            
            if (data === '[DONE]') {
              console.log(`[PayPilot] ✅ FastAPI streaming complete - ${tokenCount} tokens, ${fullResponse.length} characters`);
              onComplete(fullResponse);
              return;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.token) {
                fullResponse += parsed.token;
                tokenCount++;
                onToken(parsed.token);
              }
            } catch (e) {
              // Skip invalid JSON lines
              console.warn('[PayPilot] Skipping invalid JSON in stream:', data);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (controller.signal.aborted) {
      console.log(`[PayPilot] ⚠️ FastAPI streaming cancelled - partial response with ${tokenCount} tokens`);
    }
    
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log(`[PayPilot] ⚠️ FastAPI streaming cancelled by user`);
      return;
    }
    console.error('[PayPilot] FastAPI streaming request failed:', error);
    throw error;
  }
}

/**
 * Check if FastAPI server is available
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${FASTAPI_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch (error) {
    console.warn('[PayPilot] FastAPI server health check failed:', error);
    return false;
  }
}
