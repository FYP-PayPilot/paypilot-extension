import * as vscode from 'vscode';
import { ApiKeyManager } from './apiKeyManager';

/**
 * Arguments for the DeepSeek API request
 * Contains all necessary parameters for making a streaming chat completion request
 */
type AskArgs = {
  apiKey: string;                           // DeepSeek API authentication key
  baseUrl: string;                          // Base URL for the DeepSeek API endpoint
  model: string;                            // Model name (e.g., 'deepseek-chat', 'deepseek-coder')
  prompt: string;                           // User's input message/question
  abortSignal?: AbortSignal;                // Optional signal for cancelling the request
  onToken: (token: string) => void;         // Callback for each streaming token received
  onDone: (full: string) => void;           // Callback when the complete response is finished
  onError: (err: unknown) => void;          // Callback for handling any errors that occur
};

/**
 * Resolves the DeepSeek API key from secure storage or settings fallback
 * 
 * This function first tries to get the API key from secure storage, then falls back
 * to VS Code settings if not found in secure storage.
 * @param context VS Code extension context for accessing secure storage
 * @returns Promise<string | undefined> The API key if configured, undefined otherwise
 */
export async function resolveApiKey(context?: vscode.ExtensionContext): Promise<string | undefined> {
  // First try secure storage if context is available
  if (context) {
    const apiKeyManager = new ApiKeyManager(context);
    const secureApiKey = await apiKeyManager.getApiKey('deepseek');
    if (secureApiKey) {
      return secureApiKey;
    }
  }
  
  // Fallback to VS Code settings
  const config = vscode.workspace.getConfiguration('paypilot');
  return config.get<string>('deepseekApiKey');
}

/**
 * Sends a streaming request to the DeepSeek API and handles the response
 * 
 * This function makes a POST request to the DeepSeek chat completions endpoint
 * with streaming enabled. It processes the Server-Sent Events (SSE) response
 * in real-time, calling the provided callbacks as tokens arrive.
 * 
 * The streaming approach allows for real-time display of the AI response,
 * providing better user experience compared to waiting for the full response.
 * 
 * @param args - Configuration object containing API credentials, model settings, and callbacks
 */
export async function askDeepSeek(args: AskArgs): Promise<void> {
  // Destructure all required parameters from the arguments object
  const { apiKey, baseUrl, model, prompt, abortSignal, onToken, onDone, onError } = args;
  
  let fullResponse = ''; // Declare in outer scope for access in catch block
  
  try {
    // Construct the API endpoint URL, ensuring no trailing slashes
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    
    // Make the HTTP request to the DeepSeek API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        // Authentication header with Bearer token format
        'Authorization': `Bearer ${apiKey}`,
        // Specify JSON content type for the request body
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,                                // AI model to use for generation
        messages: [{ role: 'user', content: prompt }], // User's message in chat format
        stream: true,                         // Enable streaming response
        temperature: 0.2                      // Low temperature for more focused responses
      }),
      signal: abortSignal                     // Include abort signal for cancellation
    });

    // Check if the API request was successful
    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    // Ensure we received a response body for streaming
    if (!response.body) {
      throw new Error('No response body received from DeepSeek API');
    }

    // Set up streaming response processing
    const reader = response.body.getReader();           // Get readable stream reader
    const decoder = new TextDecoder('utf-8');          // Decoder for converting bytes to text
    // fullResponse is already declared in outer scope

    // Process the streaming response in chunks
    while (true) {
      // Read the next chunk from the stream
      const { done, value } = await reader.read();
      
      // Exit loop when stream is complete
      if (done) break;

      // Convert the chunk bytes to text
      const chunk = decoder.decode(value, { stream: true });
      
      // Parse Server-Sent Events (SSE) format
      // Split chunk into lines and filter out empty ones
      const lines = chunk
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      // Process each line in the chunk
      for (const line of lines) {
        // Skip lines that don't contain SSE data
        if (!line.startsWith('data:')) continue;
        
        // Extract the JSON data after "data: " prefix
        const data = line.slice(5).trim();
        
        // Check for stream completion marker
        if (data === '[DONE]') {
          onDone(fullResponse);
          return;
        }

        try {
          // Parse the JSON response chunk
          const parsed = JSON.parse(data);
          
          // Extract the content delta from the response
          // The delta contains the new text tokens for this chunk
          const delta = parsed.choices?.[0]?.delta?.content ?? '';
          
          // If we received new content, process it
          if (delta) {
            fullResponse += delta;              // Add to complete response
            onToken(delta);                     // Send token to UI for real-time display
          }
        } catch (parseError) {
          // Ignore parse errors for keep-alive chunks or malformed data
          // This is common with SSE streams and doesn't indicate a real error
          console.debug('Failed to parse SSE chunk:', data);
        }
      }
    }

    // Fallback: Ensure onDone is called even if [DONE] marker wasn't received
    // This handles cases where the stream ends without the explicit marker
    onDone(fullResponse);

  } catch (error) {
    // Handle different types of errors appropriately
    if (error instanceof Error && error.name === 'AbortError') {
      // Request was cancelled - this is expected behavior, not an error
      onDone(fullResponse || 'Generation stopped by user');
    } else {
      // Pass other errors to the error callback for handling by the caller
      onError(error);
    }
  }
}