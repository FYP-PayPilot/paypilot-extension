/**
 * Message types for webview ↔ extension communication
 * Defines the streaming protocol for real-time AI responses
 */

// Messages sent from webview to extension
export interface ChatAskMessage {
  type: 'chat:ask';                    // Initiates AI chat request
  prompt: string;                      // User's input message
  mode: 'agent' | 'ask';              // Response mode: code generation vs Q&A
  model: string;                       // Selected model identifier
}

export interface ChatStopMessage {
  type: 'chat:stop';                   // Cancels ongoing AI generation
}

export interface ModelChangeMessage {
  type: 'model:change';                // Updates selected model
  model: string;                       // New model identifier
}

export interface ModelListRequestMessage {
  type: 'model:list-request';          // Requests available models
}

export interface DiffActionMessage {
  type: 'diff:action';
  action: 'keep' | 'undo';
  lineNumber?: number;                 // undefined means all changes
}

export interface FileOpenMessage {
  type: 'file:open';
  filePath: string;
}

export type WebviewToExtensionMessage = 
  | ChatAskMessage 
  | ChatStopMessage
  | ModelChangeMessage
  | ModelListRequestMessage
  | DiffActionMessage
  | FileOpenMessage;

// Messages sent from extension to webview (streaming responses)
export interface ChatStreamMessage {
  type: 'chat:stream';                 // Real-time token delivery from AI
  token: string;                       // Individual word/character from response
}

export interface ChatDoneMessage {
  type: 'chat:done';                   // Signals completion of streaming
  text: string;                        // Final complete response text
}

export interface ChatErrorMessage {
  type: 'chat:error';                  // Error during AI request/streaming
  error: string;
}

export interface ChatStoppedMessage {
  type: 'chat:stopped';                // Confirms manual stop was processed
}

export interface ModelListMessage {
  type: 'model:list';                  // Available models response
  models: ModelInfo[];
}

export interface DiffAppliedMessage {
  type: 'diff:applied';
}

export interface ChatWorkingMessage {
  type: 'chat:working';
  message: string;
}

export interface ChatCodeAppliedMessage {
  type: 'chat:code-applied';
  fileName: string;
  filePath: string;
  linesAdded: number;
  linesDeleted: number;
  explanation: string;
}

export type ExtensionToWebviewMessage = 
  | ChatStreamMessage 
  | ChatDoneMessage 
  | ChatErrorMessage 
  | ChatStoppedMessage
  | ModelListMessage
  | DiffAppliedMessage
  | ChatWorkingMessage
  | ChatCodeAppliedMessage;

// Model information for UI selection
export interface ModelInfo {
  id: string;                          // Unique identifier (VS Code model ID, e.g., 'copilot-gpt4o', 'copilot-claude35sonnet')
  name: string;                        // Display name for UI
  vendor: string;                      // Provider (e.g., 'vscode', 'openai', 'microsoft')
  family?: string;                     // Model family (e.g., 'gpt-4', 'claude')
  version?: string;                    // Model version
  maxTokens?: number;                  // Maximum context length
  description?: string;                // Optional description
  isExternal: boolean;                 // True for external APIs, false for VS Code built-in
}

// Chat message for UI state management
export interface ChatMessage {
  id: string;
  content: string;                     // Accumulated content during streaming
  role: 'user' | 'assistant';
  timestamp: number;
  isStreaming?: boolean;               // True while receiving stream tokens
  isWorking?: boolean;                 // True while showing working indicator
  codeApplied?: {                      // Present when code changes were applied
    fileName: string;
    filePath: string;
    linesAdded: number;
    linesDeleted: number;
    explanation: string;
  };
}

// Application state
export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;                  // True during active AI generation
  mode: 'agent' | 'ask';              // Current interaction mode
}
