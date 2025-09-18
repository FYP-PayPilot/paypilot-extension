
import * as vscode from 'vscode';

/**
 * Snapshot of a file tracked for AI modifications.
 * `originalUri` points to the virtual document containing the preserved baseline.
 */
export interface TrackedFile {
  readonly originalUri: vscode.Uri;
  readonly originalContent: string;
}
