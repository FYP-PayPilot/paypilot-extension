import * as path from "path";
import * as vscode from "vscode";
import { StatusBarService } from "./statusBarService";
import { OriginalContentProvider } from "./originalContentProvider";
import { FileOperation, PersistedTrackedFile, TrackedFile } from "../../types/diff";

const TRACKED_FILES_STATE_KEY = "paypilot.trackedDiffFiles"; // key for storing tracked files in workspaceState

/**
 * Service to manage tracking of files modified by AI, providing diff views and undo/accept functionality.
 * Tracks original content snapshots, manages diff tabs, and persists state across sessions.
 */
export class DiffService {
  
  private readonly trackedFiles = new Map<string, TrackedFile>(); // tracks every file PayPilot has touched, mapped to its preserved baseline snapshot.
  private readonly originalContentProvider = new OriginalContentProvider(); // serves baseline documents for diff views to VS Code
  private readonly disposables: vscode.Disposable[] = []; // resources to clean up on dispose
  private readonly openDiffFiles = new Set<string>(); // records which tracked files currently have an explicit diff tab open so toggles behave predictably.

  constructor(
    private readonly statusBarService: StatusBarService, // for updating diff-related buttons in the status bar
    private readonly workspaceState: vscode.Memento // for persisting tracked files across sessions
  ) {
    
    // Expose preserved baselines under a custom URI scheme so VS Code can load them.
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        'paypilot-original',
        this.originalContentProvider
      )
    );

    // Rehydrate any tracked files from the previous session.
    this.restoreTrackedFiles();

    // Refresh status-bar buttons whenever focus changes.
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.updateStatusBarButtons();
      })
    );
  }

  /**
   * Rehydrate tracked files from workspaceState on startup so unresolved edits persist across sessions.
   * Gets the array of persisted records, which are the file path of the modified file and its original content.
   * @returns void
   */
  private restoreTrackedFiles(): void {

    // get the persisted tracked files from workspaceState
    const persisted = this.workspaceState.get<PersistedTrackedFile[]>(TRACKED_FILES_STATE_KEY, []);
    if (!Array.isArray(persisted) || persisted.length === 0) {
      return;
    }

    // iterate over each persisted record
    for (const record of persisted) {
      
      // if the record is invalid (does not have a filePath), skip it
      if (!record?.filePath) {
        continue;
      }

      const originalUri = this.toOriginalUri(record.filePath); // create a URI for the original content
      const originalContent = record.originalContent ?? ""; // get the original content, defaulting to an empty string if undefined
      const operation: FileOperation = record.operation ?? "update"; // default to update for legacy entries
      if (!record.isDirectory) {
        this.originalContentProvider.setOriginalContent(originalUri, originalContent);
      }
      this.trackedFiles.set(record.filePath, { // set the original uri and content for each tracked file in the trackedFiles map
        originalUri,
        originalContent,
        operation,
        isDirectory: record.isDirectory,
        directorySnapshot: record.directorySnapshot,
      });
    }

    // update the status bar buttons if there are any tracked files
    if (this.hasChanges()) {
      this.updateStatusBarButtons();
    }
  }

  /**
   * Snapshot the current tracked files into workspaceState
   * The write is awaited where the user would expect durability (e.g. after AI edits)
   * @returns Promise<void>
   */
  private async persistTrackedFiles(): Promise<void> {

    // convert the trackedFiles map to an array of PersistedTrackedFile objects for storage in workspaceState
    const entries: PersistedTrackedFile[] = Array.from(this.trackedFiles.entries()).map(
      ([filePath, entry]) => ({
        filePath,
        originalContent: entry.originalContent,
        operation: entry.operation,
        isDirectory: entry.isDirectory,
        directorySnapshot: entry.directorySnapshot,
      })
    );

    try {
      await this.workspaceState.update(TRACKED_FILES_STATE_KEY, entries); // store the array in workspaceState
    } catch (error) {
      console.warn("[PayPilot] Failed to persist tracked diff files", error);
    }
  }

  /**
   * Register newly modified files coming back from the AI so we can show diffs/undo buttons.
   * Ignores files that are already being tracked to preserve the original baseline.
   * @param fileModifications Array of objects containing filePath, originalContent, and the operation performed
   * @returns Promise<void>
   */
  async trackModifiedFiles(
    fileModifications: Array<{
      filePath: string;
      originalContent: string;
      operation: FileOperation;
      isDirectory?: boolean;
      directorySnapshot?: string;
    }>
  ): Promise<void> {
    for (const mod of fileModifications) {
      const { filePath, originalContent, operation, isDirectory, directorySnapshot } = mod;
      const existing = this.trackedFiles.get(filePath);

      if (!existing) {
        const originalUri = this.toOriginalUri(filePath);
        if (!isDirectory) {
          this.originalContentProvider.setOriginalContent(originalUri, originalContent);
        }
        this.trackedFiles.set(filePath, {
          originalUri,
          originalContent,
          operation,
          isDirectory,
          directorySnapshot,
        });
        continue;
      }

      let nextOriginalContent = existing.originalContent;
      let nextDirectorySnapshot = existing.directorySnapshot;

      if (operation === 'delete') {
        if (originalContent.length > 0 && (existing.operation !== 'delete' || existing.originalContent.length === 0)) {
          nextOriginalContent = originalContent;
        }
        if (directorySnapshot && (!existing.directorySnapshot || existing.operation !== 'delete')) {
          nextDirectorySnapshot = directorySnapshot;
        }
      }

      const nextEntry: TrackedFile = {
        originalUri: existing.originalUri,
        originalContent: nextOriginalContent,
        operation,
        isDirectory,
        directorySnapshot: nextDirectorySnapshot,
      };

      if (!isDirectory) {
        this.originalContentProvider.setOriginalContent(
          nextEntry.originalUri,
          nextEntry.originalContent
        );
      }

      this.trackedFiles.set(filePath, nextEntry);
    }

    this.updateStatusBarButtons();
    await this.persistTrackedFiles();
  }

  /**
   * Treat every tracked file as resolved by keeping the workspace edits.
   * Closes any open diff tabs and clears the tracked files list.
   * @returns Promise<void>
   */
  async acceptAllChanges(): Promise<void> {
    if (this.trackedFiles.size === 0) {
      vscode.window.showInformationMessage("No changes to accept");
      return;
    }

    const files = this.getActiveDiffFiles();
    for (const filePath of files) {
      const entry = this.trackedFiles.get(filePath);
      await this.closeDiffForFile(filePath);
      if (entry?.operation === 'delete') {
        const targetUri = vscode.Uri.file(filePath);
        if (entry.isDirectory) {
          await this.safeDeleteDirectory(targetUri);
        } else {
          await this.safeDeleteFile(targetUri);
        }
      }
      this.removeTrackedFile(filePath);
    }

    this.updateStatusBarButtons();
  }

  /**
   * Mark the active file as resolved without altering its current contents.
   * Closes any open diff tab for the file and removes it from the tracked files list.
   * @returns Promise<void>
   */
  async rejectAllChanges(): Promise<void> {
    if (!this.hasChanges()) {
      vscode.window.showInformationMessage("No changes to reject");
      return;
    }

    const files = Array.from(this.trackedFiles.keys());
    for (const filePath of files) {
      await this.undoFile(filePath, false);
    }

    this.updateStatusBarButtons();
  }

  async keepCurrentFileChanges(): Promise<void> {
    const filePath = this.getActiveTrackedFilePath();
    if (!filePath) {
      vscode.window.showWarningMessage("No PayPilot changes to keep in the active file");
      return;
    }

    const entry = this.trackedFiles.get(filePath);
    await this.closeDiffForFile(filePath);
    if (entry?.operation === 'delete') {
      const targetUri = vscode.Uri.file(filePath);
      if (entry.isDirectory) {
        await this.safeDeleteDirectory(targetUri);
      } else {
        await this.safeDeleteFile(targetUri);
      }
    }
    this.removeTrackedFile(filePath);
    this.updateStatusBarButtons();
  }

  /**
   * Restore the active file to the captured baseline and keep the diff list tidy.
   * @returns Promise<void>
   */
  async undoCurrentFileChanges(): Promise<void> {

    // get the file path of the active tracked file if there are tracked changes
    const filePath = this.getActiveTrackedFilePath();
    if (!filePath) {
      vscode.window.showWarningMessage("No PayPilot changes to undo in the active file");
      return;
    }

    await this.undoFile(filePath); // undo the changes for the file
    this.updateStatusBarButtons(); // update status bar
  }

  /**
   * Toggle the diff view for the active tracked file.
   * Runs when the user clicks the diff button in the status bar.
   * Opens a diff tab if none is open, or closes the existing one.
   * @returns Promise<void>
   */
  async toggleDiffForActiveFile(): Promise<void> {

    // get the file path of the active tracked file if there are tracked changes
    const filePath = this.getActiveTrackedFilePath();
    if (!filePath) {
      vscode.window.showWarningMessage("No PayPilot changes to diff in the active file");
      return;
    }

    // if the diff is already open, close it, otherwise open it
    if (this.openDiffFiles.has(filePath)) {
      await this.closeDiffForFile(filePath);
    } else {
      await this.openDiffForFile(filePath);
    }

    this.updateStatusBarButtons(); // update status bar
  }

  /**
   * Get a list of all currently tracked files.
   * @returns string[] Array of file paths
   */
  getActiveDiffFiles(): string[] {
    return Array.from(this.trackedFiles.keys());
  }

  /** Check if there are any tracked files with changes.
   * @returns boolean True if there are tracked files, false otherwise
   */
  hasChanges(): boolean {
    return this.trackedFiles.size > 0;
  }

  /**
   * Check if the active tracked file has changes.
   * @returns boolean True if the active tracked file has changes, false otherwise
   */
  activeFileHasChanges(): boolean {
    return this.getActiveTrackedFilePath() !== undefined;
  }

  /**
   * Check if the active tracked file has an open diff tab.
   * @returns boolean True if the active tracked file has an open diff tab, false otherwise
   */
  isActiveDiffOpen(): boolean {
    const filePath = this.getActiveTrackedFilePath(); // get the file path of the active tracked file if there are tracked changes
    return filePath ? this.openDiffFiles.has(filePath) : false; // return true if filepath is in the openDiffFiles set, false if not
  }

  /**
   * Lightweight diff stats for progress UI. Avoids pulling in heavier dependencies.
   * Uses a simple LCS algorithm to count added and deleted lines.
   * @param oldLines Array of strings representing the original file lines
   * @param newLines Array of strings representing the modified file lines
   * @returns Object with counts of added and deleted lines
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
   * Clean up resources when the service is disposed.
   * Closes registered disposables, persists tracked files, and clears diff state.
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

    void this.persistTrackedFiles();
    this.trackedFiles.clear();
    this.originalContentProvider.dispose();
    this.openDiffFiles.clear();
  }

  /**
   * Open a dedicated diff tab comparing the saved baseline with the live workspace file.
   * @param filePath A string representing the file path to open the diff for
   * @returns Promise<void>
   */
  public async openDiffForFile(filePath: string): Promise<void> {

    // if the diff is already open, do nothing and return
    if (this.openDiffFiles.has(filePath)) {
      return;
    }

    // get the tracked file entry for the specified file path
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    const modifiedUri = vscode.Uri.file(filePath); // URI for the modified file in the workspace
    const label = `${this.getFileName(filePath)} • PayPilot Diff`; // label for the diff tab

    // open the diff view
    await vscode.commands.executeCommand(
      'vscode.diff',
      entry.originalUri,
      modifiedUri,
      label,
      {
        preview: false,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Active,
      }
    );

    this.openDiffFiles.add(filePath); // add the file path to the set of open diff files
  }

  /**
   * Close any open diff tab for the specified file and optionally reopen the standard editor.
   * @param filePath A string representing the file path to close the diff for
   * @param reopenEditor A boolean indicating whether to reopen the standard editor after closing the diff (default: true)
   * @returns Promise<void>
   */
  private async closeDiffForFile(filePath: string, reopenEditor: boolean = true): Promise<void> {
    
    const diffTabs: vscode.Tab[] = []; // array to hold any open diff tabs for the specified file

    // iterate over all tab groups and their tabs to find any open diff tabs for the specified file
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputTextDiff) {
          const modified = tab.input.modified;
          if (modified.scheme === 'file' && modified.fsPath === filePath) {
            diffTabs.push(tab);
          }
        }
      }
    }

    const diffWasOpen = diffTabs.length > 0;

    // if there are any open diff tabs for the specified file, close them
    if (diffWasOpen) {
      try {
        await vscode.window.tabGroups.close(diffTabs, true);
      } catch (error) {
        console.warn(`[PayPilot] Failed to close diff tab for ${filePath}:`, error);
      }
    }

    this.openDiffFiles.delete(filePath); // remove the file path from the set of open diff files

    // if the reopenEditor flag is true, reopen the standard editor for the specified file
    if (reopenEditor && diffWasOpen) {
      const alreadyActive =
        vscode.window.activeTextEditor?.document.uri.fsPath === filePath;
      if (!alreadyActive) {
        try {
          await vscode.window.showTextDocument(vscode.Uri.file(filePath), {
            preview: false,
          });
        } catch (error) {
          console.warn(`[PayPilot] Unable to reopen editor for ${filePath}:`, error);
        }
      }
    }
  }

  /**
   * Single-file undo that replays the captured baseline and optionally reopens the editor.
   * @param filePath A string representing the file path to undo changes for
   * @param reopenEditor A boolean indicating whether to reopen the standard editor after undoing (default: true)
   * @returns Promise<void>
   */
  private async undoFile(filePath: string, reopenEditor: boolean = true): Promise<void> {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    await this.closeDiffForFile(filePath, false);
    const uri = vscode.Uri.file(filePath);

    try {
      if (entry.isDirectory) {
        await this.undoDirectoryChange(entry, uri);
      } else {
        switch (entry.operation) {
          case "create":
            await this.safeDeleteFile(uri);
            break;
          case 'delete':
            await this.ensureParentDirectory(uri);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(entry.originalContent, 'utf8'));
            if (reopenEditor) {
              const restoredDocument = await vscode.workspace.openTextDocument(uri);
              await vscode.window.showTextDocument(restoredDocument, { preview: false });
            }
            break;
          default: {
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
            if (reopenEditor) {
              await vscode.window.showTextDocument(document, { preview: false });
            }
            break;
          }
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to undo changes for ${this.getFileName(filePath)}`);
      console.error(`[PayPilot] Undo failed for ${filePath}:`, error);
      return;
    }

    this.removeTrackedFile(filePath);
  }

  /**
   * House-keeping when a file leaves the diff queue: forget it locally and persist the new state
   * @param filePath A string representing the file path to remove from tracking
   * @returns void
   */
  private removeTrackedFile(filePath: string): void {

    // get the tracked file entry for the specified file path
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    this.trackedFiles.delete(filePath); // delete the file from the tracked files map
    this.openDiffFiles.delete(filePath); // delete the file from the set of open diff files if it exists
    this.originalContentProvider.clearOriginalContent(entry.originalUri); // clear the original content from the content provider
    void this.persistTrackedFiles(); // persist the updated tracked files list
  }

  /**
   * Method to refresh status bar buttons, e.g. after external state changes
   * @returns void
   */
  refreshStatusBarButtons(): void {
    this.updateStatusBarButtons();
  }

  /**
   * Reflect the latest diff state in the status bar buttons
   * Enables/disables buttons based on whether there are tracked changes and if the active file has changes.
   * Also indicates if the diff view for the active file is open.
   * @returns void
   */
  private updateStatusBarButtons(): void {
    const activeFilePath = this.getActiveTrackedFilePath(); // get the file path of the active tracked file if there are tracked changes
    const currentFileHasChanges = !!activeFilePath; // boolean indicating if the active file has changes
    const currentFileDiffOpen = activeFilePath ? this.openDiffFiles.has(activeFilePath) : false; // boolean indicating if the diff view for the active file is open

    // update the status bar buttons based on the current state of the file
    this.statusBarService.showEnhancedDiffButtons(
      this.hasChanges(),
      currentFileHasChanges,
      this.trackedFiles.size,
      currentFileDiffOpen
    );
  }

  /**
   * Resolve the active editor to a tracked file path if it is under PayPilot control.
   * Returns undefined if there is no active editor or if the active file is not tracked.
   * @returns string | undefined The file path of the active tracked file, or undefined if none
   */
  private getActiveTrackedFilePath(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    const filePath = editor.document.uri.fsPath;
    return this.trackedFiles.has(filePath) ? filePath : undefined;
  }

  /**
   * Normalise the synthetic URI we use for baseline documents
   * Strips any query or fragment components to ensure consistent mapping
   * @param filePath A string representing the file path to convert
   * @returns vscode.Uri The normalized URI for the original content
   */
  private async safeDeleteFile(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return;
      }
      console.warn(`[PayPilot] Failed to delete ${uri.fsPath} during undo:`, error);
    }
  }

  private async safeDeleteDirectory(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return;
      }
      console.warn(`[PayPilot] Failed to delete directory ${uri.fsPath} during undo:`, error);
    }
  }

  private async undoDirectoryChange(entry: TrackedFile, uri: vscode.Uri): Promise<void> {
    if (entry.operation === 'create') {
      if (await this.isDirectoryEmpty(uri)) {
        await this.safeDeleteDirectory(uri);
      } else {
        console.warn(`[PayPilot] Skipped removing ${uri.fsPath} because it is not empty.`);
      }
      return;
    }

    if (!entry.directorySnapshot) {
      return;
    }

    await this.restoreDirectorySnapshot(uri, entry.directorySnapshot);
  }

  private async isDirectoryEmpty(uri: vscode.Uri): Promise<boolean> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      return entries.length === 0;
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return true;
      }
      throw error;
    }
  }

  private async restoreDirectorySnapshot(baseUri: vscode.Uri, snapshotJson: string): Promise<void> {
    const entries: Array<{ path: string; type: 'file' | 'directory'; content?: string }> = JSON.parse(snapshotJson);

    await vscode.workspace.fs.createDirectory(baseUri);

    for (const entry of entries) {
      const target = vscode.Uri.joinPath(baseUri, entry.path);
      if (entry.type === 'directory') {
        await vscode.workspace.fs.createDirectory(target);
      } else {
        await this.ensureParentDirectory(target);
        const content = entry.content ? Buffer.from(entry.content, 'base64') : Buffer.from('');
        await vscode.workspace.fs.writeFile(target, content);
      }
    }
  }

  private async ensureParentDirectory(uri: vscode.Uri): Promise<void> {
    const dirPath = path.dirname(uri.fsPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
  }

  private toOriginalUri(filePath: string): vscode.Uri {
    return vscode.Uri.file(filePath).with({ scheme: 'paypilot-original', query: '', fragment: '' });
  }

  /**
   * Convenience for user-facing messages where a bare filename reads better.
   * @param filePath A string representing the full file path
   * @returns string The base name of the file
   */
  private getFileName(filePath: string): string {
    return path.basename(filePath);
  }
}
