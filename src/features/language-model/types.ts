/**
 * Types specific to the language model domain.
 */

/** Sent from ChatInput model dropdown to change selected model */
export interface ModelChangeMessage {
  type: 'model:change';                // Updates selected model
  model: string;                       // New model identifier
}

/** Sent from useChat hook on mount to load available models */
export interface ModelListRequestMessage {
  type: 'model:list-request';          // Requests available models
}

/** Response to ModelListRequestMessage - populates model dropdown */
export interface ModelListResponse {
  type: 'model:list';                  // Response with available models
  models: ModelInfo[];
}

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