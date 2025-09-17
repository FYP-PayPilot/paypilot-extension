
import * as vscode from 'vscode';
import { OriginalContentProvider}  from '../services/diff/originalContentProvider';
import { PayPilotQuickDiffProvider } from '../services/diff/paypilotQuickDiffProvider';
/**
 * Interface for diff state management
 */
export interface DiffState {
  originalContent: string;
  documentUri: vscode.Uri;
  sourceControl?: vscode.SourceControl;
  originalContentProvider?: OriginalContentProvider;
  quickDiffProvider?: PayPilotQuickDiffProvider;
  isDiffViewOpen: boolean;
  diffViewDisposables: vscode.Disposable[];
  diffViewColumn?: vscode.ViewColumn;
}

/**
 * Interface representing a file pending sequential review
 */
export interface PendingFileReview {
  filePath: string;
  fileName: string;
  originalContent: string;
  modifiedContent: string;
  summary?: string;
  linesAdded: number;
  linesDeleted: number;
}

/**
 * Multi-file diff state management
 */
export interface MultiFileDiffState {
  [filePath: string]: DiffState;
}