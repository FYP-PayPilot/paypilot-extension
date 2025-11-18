/**
 * Message types for webview ↔ extension communication
 * Defines the streaming protocol for real-time AI responses
 */
import { ModelInfo, ModelChangeMessage, ModelListRequestMessage, ModelListResponse } from '../language-model/types';
import { ContextFile } from '../context/types';

/** Sent from ChatInput component when user submits a message */
export interface ChatQueryMessage {
  type: 'chat:query';                  // Initiates AI chat request
  prompt: string;                      // User's input message
  mode: 'agent' | 'ask';              // Response mode: code generation vs Q&A
  model: string;                       // Selected model identifier
  source?: 'vscode' | 'backend';       // Source of the model to route ask mode correctly
  contextFiles?: ContextFile[];
}

/** Sent from ChatInput stop button to cancel AI generation */
export interface ChatStopMessage {
  type: 'chat:stop';                   // Cancels ongoing AI generation
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

/** Sent from ChatInput MCP checkbox to toggle MCP functionality */
// export interface McpToggleMessage {
//   type: 'mcp:toggle';
//   enabled: boolean;
// }

/** Sent from ChatInput to request available MCP servers */
// export interface GetMcpServersMessage {
//   type: "mcp:get";
// }

/** Union type used in VSCodeContext for type-safe message routing */
export type WebviewToExtensionMessage =
  | ChatQueryMessage
  | ChatStopMessage
  | ModelChangeMessage
  | ModelListRequestMessage
  | FileOpenMessage
  | ContextRequestMessage
  | ContextAddMessage
  | ContextRemoveMessage
  | ContextClearMessage;
  // | McpToggleMessage
  // | GetMcpServersMessage;

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
  operation: 'create' | 'update' | 'delete';
}

export interface ChatToolActivityMessage {
  type: 'chat:tool-activity';
  title: string;
  detail?: string;
  filePath?: string;
  operation?: string;
}

export interface ChatAgentSummaryMessage {
  type: 'chat:agent-summary';
  text: string;
}

export interface FileChange {
  fileName: string;
  filePath: string;
  operation:
    | "create"
    | "update"
    | "delete"
    | "directory"
    | "directory-delete"
    | "read";
  linesAdded?: number;
  linesDeleted?: number;
}

export interface ChatMultiFileEditSummaryMessage {
  type: "chat:multi-file-edit-summary";
  changes: FileChange[];
  totalLinesAdded: number;
  totalLinesDeleted: number;
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

/** Triggers file picker UI (not used - handled directly in extension) */
export interface ContextFilePickerMessage {
  type: 'context:file-picker';
  // No additional data needed - this triggers the file picker
}

/** Response with available MCP servers */
// export interface McpServersResponse {
//   type: 'mcp:servers';
//   servers: McpServer[];
// }

/** Union type used in VSCodeContext for type-safe message routing */
export type ExtensionToWebviewMessage =
  | ChatStreamMessage
  | ChatDoneMessage
  | ChatErrorMessage
  | ChatStoppedMessage
  | ModelListMessage
  | ChatWorkingMessage
  | ChatCodeAppliedMessage
  | ChatToolActivityMessage
  | ChatAgentSummaryMessage
  | ChatMultiFileEditSummaryMessage
  | ContextListMessage
  | ContextAddResponseMessage
  | ContextFilePickerMessage;
  // | McpServersResponse;

/** MCP Server configuration used in MCP functionality */
// export interface McpServer {
//   name: string;
//   type: string;
//   url?: string;
//   command?: string;
//   args?: string[];
// }

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
    operation: 'create' | 'update' | 'delete';
  };
  toolActivity?: {
    title: string;
    detail?: string;
    filePath?: string;
    operation?: string;
  };
  multiFileEditSummary?: {
    changes: FileChange[];
    totalLinesAdded: number;
    totalLinesDeleted: number;
  };
}

/** Main state interface used in useChat hook for chat UI management */
export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;                  // True during active AI generation
  mode: 'agent' | 'ask';              // Current interaction mode
  contextFiles: ContextFile[];        // Files added for context
}

/** Tool context for tracking file operations during agent mode */
export interface ToolContext {
  uri: import('vscode').Uri;
  operation: import('../diff/types').FileOperation;
  originalContent: string;
  isDirectory?: boolean;
  directorySnapshot?: string;
}

/** Session file change tracking for multi-file edit summaries */
export interface SessionFileChange {
  fileName: string;
  filePath: string;
  operation: "create" | "update" | "delete" | "directory" | "directory-delete" | "read";
  linesAdded?: number;
  linesDeleted?: number;
}

/** Interface for messages sent between webview and extension
 * Used in MessageHandlerService and VSCodeContext for type-safe routing
 */
export interface ChatMessage {
  type?: string;
  prompt?: string;
  mode?: string;
  model?: string;
  contextFiles?: Array<{ filePath: string }>;
  filePaths?: string[];
  filePath?: string;
  title?: string;
  enabled?: boolean;
  [key: string]: unknown;
}
