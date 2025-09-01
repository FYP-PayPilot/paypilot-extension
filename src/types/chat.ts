/**
 * Message types for webview ↔ extension communication
 * Defines the streaming protocol for real-time AI responses
 */

// Messages sent from webview to extension
export interface ChatAskMessage {
  type: 'chat:ask';                    // Initiates AI chat request
  prompt: string;                      // User's input message
  mode: 'agent' | 'ask';              // Response mode: code generation vs Q&A
}

export interface ChatStopMessage {
  type: 'chat:stop';                   // Cancels ongoing AI generation
}

export interface DiffActionMessage {
  type: 'diff:action';
  action: 'keep' | 'undo';
  lineNumber?: number;                 // undefined means all changes
}

export interface McpToggleMessage {
  type: 'mcp:toggle';
  enabled: boolean;
}

export interface GetMcpServersMessage {
  type: 'mcp:get';
}

export type WebviewToExtensionMessage = 
  | ChatAskMessage 
  | ChatStopMessage
  | DiffActionMessage
  | GetMcpServersMessage
  | McpToggleMessage;

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

export interface DiffAppliedMessage {
  type: 'diff:applied';
}

export interface McpServersResponse {
  type: 'mcp:servers';
  servers: string[];
}

export type ExtensionToWebviewMessage = 
  | ChatStreamMessage 
  | ChatDoneMessage 
  | ChatErrorMessage 
  | ChatStoppedMessage
  | DiffAppliedMessage
  | McpServersResponse;

// Chat message for UI state management
export interface ChatMessage {
  id: string;
  content: string;                     // Accumulated content during streaming
  role: 'user' | 'assistant';
  timestamp: number;
  isStreaming?: boolean;               // True while receiving stream tokens
}

// Application state
export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;                  // True during active AI generation
  mode: 'agent' | 'ask';              // Current interaction mode
}
