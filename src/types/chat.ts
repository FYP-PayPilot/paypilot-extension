/**
 * Message types for communication between extension and webview
 */

// Messages sent from webview to extension
export interface ChatAskMessage {
  type: 'chat:ask';
  prompt: string;
  mode: 'agent' | 'ask';
}

export interface ChatStopMessage {
  type: 'chat:stop';
}

export interface DiffActionMessage {
  type: 'diff:action';
  action: 'keep' | 'undo';
  lineNumber?: number; // undefined means all changes
}

export type WebviewToExtensionMessage = 
  | ChatAskMessage 
  | ChatStopMessage
  | DiffActionMessage;

// Messages sent from extension to webview
export interface ChatStreamMessage {
  type: 'chat:stream';
  token: string;
}

export interface ChatDoneMessage {
  type: 'chat:done';
  text: string;
}

export interface ChatErrorMessage {
  type: 'chat:error';
  error: string;
}

export interface ChatStoppedMessage {
  type: 'chat:stopped';
}

export interface DiffAppliedMessage {
  type: 'diff:applied';
}

export type ExtensionToWebviewMessage = 
  | ChatStreamMessage 
  | ChatDoneMessage 
  | ChatErrorMessage 
  | ChatStoppedMessage
  | DiffAppliedMessage;

// Chat message for UI
export interface ChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: number;
  isStreaming?: boolean;
}

// Application state
export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  mode: 'agent' | 'ask';
}
