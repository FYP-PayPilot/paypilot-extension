/**
 * Message types for webview ↔ extension communication
 * Defines the streaming protocol for real-time AI responses
 */

/** Sent from ChatInput component when user submits a message */
export interface ChatAskMessage {
  type: 'chat:ask';                    // Initiates AI chat request
  prompt: string;                      // User's input message
  mode: 'agent' | 'ask';              // Response mode: code generation vs Q&A
  model: string;                       // Selected model identifier
  contextFiles?: ContextFile[];
}

/** Sent from ChatInput stop button to cancel AI generation */
export interface ChatStopMessage {
  type: 'chat:stop';                   // Cancels ongoing AI generation
}

/** Sent from ChatInput model dropdown to change selected model */
export interface ModelChangeMessage {
  type: 'model:change';                // Updates selected model
  model: string;                       // New model identifier
}

/** Sent from useChat hook on mount to load available models */
export interface ModelListRequestMessage {
  type: 'model:list-request';          // Requests available models
}

/** Sent from CodeAppliedCard when user clicks to open file */
export interface FileOpenMessage {
  type: 'file:open';
  filePath: string;
}

/** Sent from ContextButton when user wants to add context files */
export interface ContextRequestMessage {
  type: 'context:request';
}

/** Not directly sent - used for file picker flow */
export interface ContextAddMessage {
  type: 'context:add';
  filePaths: string[];
}

/** Sent from ContextList when user removes a context file */
export interface ContextRemoveMessage {
  type: 'context:remove';
  filePath: string;
}

/** Sent from ContextList when user clears all context files */
export interface ContextClearMessage {
  type: 'context:clear';
}

/** Union type used in VSCodeContext for type-safe message routing */
export type WebviewToExtensionMessage =
  | ChatAskMessage
  | ChatStopMessage
  | ModelChangeMessage
  | ModelListRequestMessage
  | FileOpenMessage
  | ContextRequestMessage
  | ContextAddMessage
  | ContextRemoveMessage
  | ContextClearMessage
  | GetMcpServersMessage
  | McpToggleMessage;

/** Sent during ask mode streaming - received in useChat message handler */
export interface ChatStreamMessage {
  type: 'chat:stream';                 // Real-time token delivery from AI
  token: string;                       // Individual word/character from response
}

/** Sent when AI response completes - triggers final UI state update */
export interface ChatDoneMessage {
  type: 'chat:done';                   // Signals completion of streaming
  text: string;                        // Final complete response text
}

/** Sent on AI request failures - displays error in chat */
export interface ChatErrorMessage {
  type: 'chat:error';                  // Error during AI request/streaming
  error: string;
}

/** Sent when user stops generation - confirms stop action completed */
export interface ChatStoppedMessage {
  type: 'chat:stopped';                // Confirms manual stop was processed
}

/** Response to ModelListRequestMessage - populates model dropdown */
export interface ModelListMessage {
  type: 'model:list';                  // Available models response
  models: ModelInfo[];
}

/** Sent during agent mode to show working state before code generation */
export interface ChatWorkingMessage {
  type: 'chat:working';
  message: string;
}

/** Sent after agent mode applies code - shows CodeAppliedCard component */
export interface ChatCodeAppliedMessage {
  type: 'chat:code-applied';
  fileName: string;
  filePath: string;
  linesAdded: number;
  linesDeleted: number;
  explanation: string;
}

/** Sent to update context files list in UI */
export interface ContextListMessage {
  type: 'context:list';
  files: ContextFile[];
}

/** Sent to add new files to context - merges with existing */
export interface ContextAddResponseMessage {
  type: 'context:add';
  files: ContextFile[];
}

export interface McpServersResponse {
  type: 'mcp:servers';
  servers: string[];
}

export interface McpServersResponse {
  type: 'mcp:servers';
  servers: string[];
}

/** Triggers file picker UI (not used - handled directly in extension) */
export interface ContextFilePickerMessage {
  type: 'context:file-picker';
  // No additional data needed - this triggers the file picker
}

/** Union type used in VSCodeContext for type-safe message routing */
export type ExtensionToWebviewMessage =
  | ChatStreamMessage
  | ChatDoneMessage
  | ChatErrorMessage
  | ChatStoppedMessage
  | ModelListMessage
  | ChatWorkingMessage
  | ChatCodeAppliedMessage
  | ContextListMessage
  | ContextAddResponseMessage
  | ContextFilePickerMessage
  | McpServersResponse;

/** Used in ChatInput dropdown and languageModel service */
export interface ModelInfo {
  id: string; // Unique identifier (VS Code model ID, e.g., 'copilot-gpt4o', 'copilot-claude35sonnet')
  name: string; // Display name for UI
  vendor: string; // Provider (e.g., 'vscode', 'openai', 'microsoft')
  family?: string; // Model family (e.g., 'gpt-4', 'claude')
  version?: string; // Model version
  maxTokens?: number; // Maximum context length
  description?: string; // Optional description
  isExternal: boolean; // True for external APIs, false for VS Code built-in
}

// Context file information
/** Used in ContextList, ContextButton, and chat state management */
export interface ContextFile {
  filePath: string; // Absolute path to the file
  fileName: string; // Display name (basename)
  content?: string; // File content (loaded when needed)
  size?: number; // File size in bytes
}

/** Core message type used throughout ChatMessage component and useChat hook */
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

/** Main state interface used in useChat hook for chat UI management */
export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;                  // True during active AI generation
  mode: 'agent' | 'ask';              // Current interaction mode
  contextFiles: ContextFile[];        // Files added for context
}
