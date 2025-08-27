/**
 * Message types for communication between extension and webview
 */

// Messages sent from webview to extension
export interface ChatAskMessage {
  type: 'chat:ask';
  prompt: string;
}

export interface EditorApplyMessage {
  type: 'editor:applyEdit';
  payload: {
    mode: 'selection' | 'file';
    code: string;
  };
}

export interface EditorCreateFileMessage {
  type: 'editor:createFile';
  payload: {
    code: string;
  };
}

export type WebviewToExtensionMessage = 
  | ChatAskMessage 
  | EditorApplyMessage 
  | EditorCreateFileMessage;

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

export interface EditorAppliedMessage {
  type: 'editor:applied';
}

export type ExtensionToWebviewMessage = 
  | ChatStreamMessage 
  | ChatDoneMessage 
  | ChatErrorMessage 
  | EditorAppliedMessage;

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
  lastAssistantMessage: string;
  canApplyCode: boolean;
}
