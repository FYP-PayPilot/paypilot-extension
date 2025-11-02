import * as vscode from "vscode";

/**
 * Type definitions for PayPilot workspace tools
 */

/** Input parameters for workspace context discovery */
export interface WorkspaceContextInput {
  /** Glob pattern to match files (default: "**") */
  glob?: string;
  /** Maximum number of files to return (1-50) */
  maxFiles?: number;
  /** Whether to include file contents in results */
  includeText?: boolean;
}

/** Base input for file operations */
export interface FileOperationInput {
  /** Relative path from workspace root */
  path: string;
  /** File contents (UTF-8 encoded) */
  contents?: string;
}

/** Input for file update operations */
export interface UpdateFileInput {
  /** Relative path for file to update */
  path: string;
  /** New file contents (replaces entire file) */
  contents: string;
}

/** Input for file deletion operations */
export interface DeleteFileInput {
  /** Relative path for file to delete */
  path: string;
}

/** Input for file reading operations */
export interface ReadFileInput {
  /** Relative path for file to read */
  path: string;
}

/** Input for directory creation operations */
export interface CreateDirectoryInput {
  /** Relative path for directory to create */
  path: string;
}

/** Input for directory deletion operations */
export interface DeleteDirectoryInput {
  /** Relative path for directory to delete */
  path: string;
}

/** Complete PayPilot toolset interface */
export interface PaypilotToolset {
  /** Array of registered VS Code Language Model tools */
  chatTools: vscode.LanguageModelChatTool[];
}