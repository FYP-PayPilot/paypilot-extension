import * as vscode from 'vscode';

export type FileOperation = 'create' | 'update' | 'delete';

/**
 * Snapshot of a file tracked for AI modifications.
 * `originalUri` points to the virtual document containing the preserved baseline.
 */
export interface TrackedFile {
  readonly originalUri: vscode.Uri;
  readonly originalContent: string;
  readonly operation: FileOperation;
}

/**
 * Minimal payload that is stored in VS Code workspaceState to restore tracked files
 * across sessions. The actual diff service rebuilds the virtual documents from this snapshot.
 */
export interface PersistedTrackedFile {
  readonly filePath: string;
  readonly originalContent: string;
  readonly operation: FileOperation;
}
