import * as vscode from "vscode";
import { StatusBarService } from "../statusBarService";
import { OriginalContentProvider } from "./originalContentProvider";
import { PayPilotQuickDiffProvider } from "./paypilotQuickDiffProvider";
import { TrackedFile } from "../../types/diff";

/**
 * Orchestrates AI diff tracking using VS Code's Quick Diff API.
 * Remembers the earliest baseline for each modified file.
 * Exposes quick actions (keep/undo/accept-all/reject-all).
 * Registers a QuickDiffProvider so gutter decorations always compare against the baseline.
 */
export class DiffService {
  private readonly trackedFiles = new Map<string, TrackedFile>(); // map that contains file paths as keys and TrackedFile objects as values
  private readonly originalContentProvider = new OriginalContentProvider(); // provides original content for quick diff
  private readonly disposables: vscode.Disposable[] = [];
  private sourceControl: vscode.SourceControl | undefined;

  constructor(private readonly statusBarService: StatusBarService) {
    
    // expose preserved baselines under a custom URI scheme
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        'paypilot-original',
        this.originalContentProvider
      )
    );

    this.setupQuickDiffProvider(); // plug baselines into VS Code's quick diff gutter

    // refresh the status bar whenever focus changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.updateStatusBarButtons();
      })
    );
  }

  /**
   * Sets up the quick diff provider to link files to their original content
   * @returns void
   */
  private setupQuickDiffProvider(): void {
    const quickDiffProvider = new PayPilotQuickDiffProvider((uri) => {
      const entry = this.trackedFiles.get(uri.fsPath); // get the TrackedFile entry for the given file path
      return entry?.originalUri; // return the originalUri if entry exists, otherwise undefined
    });

    const root = vscode.workspace.workspaceFolders?.[0]?.uri; // get the root URI of the first workspace folder
    this.sourceControl = vscode.scm.createSourceControl('paypilot', 'PayPilot', root); // create a source control instance for PayPilot
    this.sourceControl.quickDiffProvider = quickDiffProvider; // assign the quick diff provider to the source control
    this.disposables.push({ dispose: () => this.sourceControl?.dispose() }); // ensure source control is disposed
  }

  /**
   * Undo changes for a specific file and restore original content.
   * @param filePath The path of the file to undo changes for.
   * @returns void
   */
  private async undoFile(filePath: string): Promise<void> {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    edit.replace(uri, fullRange, entry.originalContent);

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      vscode.window.showErrorMessage(`Failed to undo changes for ${this.getFileName(filePath)}`);
      return;
    }

    await document.save();
    this.removeTrackedFile(filePath);
  }

  /**
   * Stop tracking a file and clear its original content snapshot.
   * @param filePath The path of the file to stop tracking.
   * @returns void
   */
  private removeTrackedFile(filePath: string): void {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    this.trackedFiles.delete(filePath);
    this.originalContentProvider.clearOriginalContent(entry.originalUri);
  }

  /**
   * Update the status bar buttons based on the current state.
   * @returns void
   */
  private updateStatusBarButtons(): void {
    this.statusBarService.showEnhancedDiffButtons(
      this.hasChanges(),
      this.activeFileHasChanges(),
      this.trackedFiles.size
    );
  }

  /**
   * Get the file path of the currently active tracked file.
   * @returns The file path of the active tracked file or undefined.
   */
  private getActiveTrackedFilePath(): string | undefined {
    const editor = vscode.window.activeTextEditor; // get the currently active text editor
    if (!editor) {
      return undefined;
    }
    const filePath = editor.document.uri.fsPath; // get the file path of the active editor
    return this.trackedFiles.has(filePath) ? filePath : undefined; // return filePath if it is being tracked, otherwise undefined
  }

  /**
   * Converts a file path to a paypilot-original URI
   * @param filePath The path of the file.
   * @returns vscode.Uri with the paypilot-original scheme.
   */
  private toOriginalUri(filePath: string): vscode.Uri {
    return vscode.Uri.file(filePath).with({ scheme: "paypilot-original", query: "", fragment: "" });
  }

  /**
   * Extract the file name from a full file path.
   * @param filePath The full path of the file.
   * @returns The file name without the directory path.
   */
  private getFileName(filePath: string): string {
    return filePath.split(/[\/]/).pop() || filePath;
  }

  /**
   * Record the files touched by the latest AI response.
   * When a file appears for the first time we snapshot its original contents;
   * Later iterations reuse that earliest baseline.
   * @param fileModifications Array of file modifications with filePath, content, and originalContent.
   * @returns void
   */
  async trackModifiedFiles(
    fileModifications: Array<{
      fileName: string;
      filePath: string;
      content: string;
      summary?: string;
      originalContent: string;
    }>
  ): Promise<void> {
    for (const mod of fileModifications) {
      const filePath = mod.filePath; // get the file path of the modified file
      const existing = this.trackedFiles.get(filePath); // get existing TrackedFile entry if any for the file

      if (!existing) { // if there is no existing entry
        const originalUri = this.toOriginalUri(filePath); // convert file path to a paypilot-original URI
        this.originalContentProvider.setOriginalContent(originalUri, mod.originalContent); // set the original content for the URI
        this.trackedFiles.set(filePath, {
          originalUri,
          originalContent: mod.originalContent,
        }); // add a new entry to the trackedFiles map
      } else {
        // Ensure the original content provider keeps serving the preserved snapshot.
        this.originalContentProvider.setOriginalContent(
          existing.originalUri,
          existing.originalContent
        );
      }
    }

    // update the status bar buttons to reflect new changes
    this.updateStatusBarButtons();
  }

  /**
    * Accept all tracked changes and clear the the tracking map.
    * @returns void
   */
  async acceptAllChanges(): Promise<void> {

    if (this.trackedFiles.size === 0) { // if there are no tracked files
      vscode.window.showInformationMessage("No changes to accept");
      return;
    }

    const files = Array.from(this.trackedFiles.keys()); // get an array of all tracked file paths
    for (const filePath of files) {
      this.removeTrackedFile(filePath);
    }

    vscode.window.showInformationMessage(
      `Accepted changes for ${files.length} file${files.length === 1 ? "" : "s"}`
    );
    this.updateStatusBarButtons();
  }

  /**
   * Reject all tracked changes and restore original file contents.
   * @returns 
   */
  async rejectAllChanges(): Promise<void> {
    if (this.trackedFiles.size === 0) {
      vscode.window.showInformationMessage("No changes to reject");
      return;
    }

    const files = Array.from(this.trackedFiles.keys());
    for (const filePath of files) {
      await this.undoFile(filePath);
    }

    vscode.window.showInformationMessage(
      `Rejected changes for ${files.length} file${files.length === 1 ? "" : "s"}`
    );
    this.updateStatusBarButtons();
  }

  /**
   * Keep changes for currently active file and stop tracking it.
   * @returns void
   */
  async keepCurrentFileChanges(): Promise<void> {
    const filePath = this.getActiveTrackedFilePath();
    if (!filePath) {
      vscode.window.showWarningMessage("No PayPilot changes to keep in the active file");
      return;
    }

    this.removeTrackedFile(filePath);
    vscode.window.showInformationMessage(`Kept changes for ${this.getFileName(filePath)}`);
    this.updateStatusBarButtons();
  }

  /**
   * Undo changes for currently active file and restore original content and stop tracking it.
   * @returns void
   */
  async undoCurrentFileChanges(): Promise<void> {
    const filePath = this.getActiveTrackedFilePath();
    if (!filePath) {
      vscode.window.showWarningMessage("No PayPilot changes to undo in the active file");
      return;
    }

    await this.undoFile(filePath);
    vscode.window.showInformationMessage(`Undid changes for ${this.getFileName(filePath)}`);
    this.updateStatusBarButtons();
  }

  /**
   * Get the file paths of all active diff files.
   * @returns string[]
   */
  getActiveDiffFiles(): string[] {
    return Array.from(this.trackedFiles.keys());
  }

  /**
   * Check if there are any tracked changes.
   * @returns boolean - whether there are any tracked changes
   */
  hasChanges(): boolean {
    return this.trackedFiles.size > 0;
  }

  /**
   * Check if the currently active file has tracked changes.
   * @returns boolean - whether the active file has tracked changes
   */
  activeFileHasChanges(): boolean {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return false;
    }
    return this.trackedFiles.has(editor.document.uri.fsPath);
  }

  /**
   * Calculate the number of added and deleted lines between two versions of file content.
   * LCS (Longest Common Subsequence) based diff algorithm.
   * @param oldLines Array of strings representing the original file content split into lines.
   * @param newLines Array of strings representing the modified file content split into lines.
   * @returns Object with 'added' and 'deleted' properties indicating line counts.
   */
  calculateDiffStats(
    oldLines: string[],
    newLines: string[]
  ): { added: number; deleted: number } {
    const m = oldLines.length;
    const n = newLines.length;
    const lcs: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          lcs[i][j] = lcs[i - 1][j - 1] + 1;
        } else {
          lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
        }
      }
    }

    const commonLines = lcs[m][n];
    const added = n - commonLines;
    const deleted = m - commonLines;
    return { added, deleted };
  }

  /**
   * Dispose all resources held by the diff service.
   * @returns void
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      try {
        disposable.dispose();
      } catch (error) {
        console.warn("[PayPilot] Error disposing diff service resource", error);
      }
    }

    this.trackedFiles.clear();
    this.originalContentProvider.dispose();
  }

  
}
