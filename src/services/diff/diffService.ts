
import * as path from "path";
import * as vscode from "vscode";
import { StatusBarService } from "../statusBarService";
import { OriginalContentProvider } from "./originalContentProvider";
import { PersistedTrackedFile, TrackedFile } from "../../types/diff";

const TRACKED_FILES_STATE_KEY = "paypilot.trackedDiffFiles"; // key for storing tracked files in workspaceState

/**
 * Orchestrates AI edit tracking by preserving per-file baselines, driving
 * status-bar actions, and exposing helpers for toggling a full diff view on demand.
 * It also persists unresolved edits in workspaceState so reviews survive reloads.
 */
export class DiffService {
  
  private readonly trackedFiles = new Map<string, TrackedFile>(); // tracks every file PayPilot has touched, mapped to its preserved baseline snapshot.
  private readonly originalContentProvider = new OriginalContentProvider(); // serves baseline documents for diff views to VS Code
  private readonly disposables: vscode.Disposable[] = []; // resources to clean up on dispose
  private readonly openDiffFiles = new Set<string>(); // records which tracked files currently have an explicit diff tab open so toggles behave predictably.
  private readonly diffViewColumns = new Map<string, vscode.ViewColumn | undefined>(); // remembers the editor column we stole when opening a diff so we can restore the view on close.

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
      this.originalContentProvider.setOriginalContent(originalUri, originalContent); // set the original uri and content for each tracked file in the contentByUri map
      this.trackedFiles.set(record.filePath, { // set the original uri and content for each tracked file in the trackedFiles map
        originalUri,
        originalContent,
      });
    }

    // update the status bar buttons if there are any tracked files
    if (this.trackedFiles.size > 0) {
      this.updateStatusBarButtons();
    }
  }

  /**
   * Snapshot the current tracked files into workspaceState
   * The write is awaited where the user would expect durability (e.g. after AI edits)
   * @returns Promise<void>
   */
  private async persistTrackedFiles(): Promise<void> {
    const entries: PersistedTrackedFile[] = Array.from(this.trackedFiles.entries()).map(
      ([filePath, entry]) => ({
        filePath,
        originalContent: entry.originalContent,
      })
    );

    try {
      await this.workspaceState.update(TRACKED_FILES_STATE_KEY, entries);
    } catch (error) {
      console.warn("[PayPilot] Failed to persist tracked diff files", error);
    }
  }

  /**
   * Register newly modified files coming back from the AI so we can show diffs/undo buttons.
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
      const filePath = mod.filePath;
      const existing = this.trackedFiles.get(filePath);

      if (!existing) {
        const originalUri = this.toOriginalUri(filePath);
        this.originalContentProvider.setOriginalContent(originalUri, mod.originalContent);
        this.trackedFiles.set(filePath, {
          originalUri,
          originalContent: mod.originalContent,
        });
      } else {
        // Ensure the content provider continues to serve the preserved snapshot.
        this.originalContentProvider.setOriginalContent(
          existing.originalUri,
          existing.originalContent
        );
      }
    }

    this.updateStatusBarButtons();
    await this.persistTrackedFiles();
  }

  /**
   * Treat every tracked file as resolved by keeping the workspace edits.
   */
  async acceptAllChanges(): Promise<void> {
    if (this.trackedFiles.size === 0) {
      vscode.window.showInformationMessage("No changes to accept");
      return;
    }

    const files = Array.from(this.trackedFiles.keys());
    for (const filePath of files) {
      await this.closeDiffForFile(filePath);
      this.removeTrackedFile(filePath);
    }

    vscode.window.showInformationMessage(
      `Accepted changes for ${files.length} file${files.length === 1 ? "" : "s"}`
    );
    this.updateStatusBarButtons();
  }

  /**
   * Revert every tracked file back to its captured baseline.
   */
  async rejectAllChanges(): Promise<void> {
    if (this.trackedFiles.size === 0) {
      vscode.window.showInformationMessage("No changes to reject");
      return;
    }

    const files = Array.from(this.trackedFiles.keys());
    for (const filePath of files) {
      await this.undoFile(filePath, false);
    }

    vscode.window.showInformationMessage(
      `Rejected changes for ${files.length} file${files.length === 1 ? "" : "s"}`
    );
    this.updateStatusBarButtons();
  }

  /**
   * Mark the active file as resolved without altering its current contents.
   */
  async keepCurrentFileChanges(): Promise<void> {
    const filePath = this.getActiveTrackedFilePath();
    if (!filePath) {
      vscode.window.showWarningMessage("No PayPilot changes to keep in the active file");
      return;
    }

    await this.closeDiffForFile(filePath);
    this.removeTrackedFile(filePath);
    vscode.window.showInformationMessage(`Kept changes for ${this.getFileName(filePath)}`);
    this.updateStatusBarButtons();
  }

  /**
   * Restore the active file to the captured baseline and keep the diff list tidy.
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

  async toggleDiffForActiveFile(): Promise<void> {
    const filePath = this.getActiveTrackedFilePath();
    if (!filePath) {
      vscode.window.showWarningMessage("No PayPilot changes to diff in the active file");
      return;
    }

    if (this.openDiffFiles.has(filePath)) {
      await this.closeDiffForFile(filePath);
    } else {
      await this.openDiffForFile(filePath);
    }

    this.updateStatusBarButtons();
  }

  getActiveDiffFiles(): string[] {
    return Array.from(this.trackedFiles.keys());
  }

  hasChanges(): boolean {
    return this.trackedFiles.size > 0;
  }

  activeFileHasChanges(): boolean {
    return this.getActiveTrackedFilePath() !== undefined;
  }

  isActiveDiffOpen(): boolean {
    const filePath = this.getActiveTrackedFilePath();
    return filePath ? this.openDiffFiles.has(filePath) : false;
  }

  /**
   * Lightweight diff stats for progress UI. Avoids pulling in heavier dependencies.
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
  }

  /**
   * Open a dedicated diff tab comparing the saved baseline with the live workspace file.
   */
  public async openDiffForFile(filePath: string): Promise<void> {
    if (this.openDiffFiles.has(filePath)) {
      return;
    }

    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    this.diffViewColumns.set(filePath, vscode.window.activeTextEditor?.viewColumn);

    await this.closePlainEditorForFile(filePath);

    const label = `${this.getFileName(filePath)} • PayPilot Diff`;
    await vscode.commands.executeCommand(
      'vscode.diff',
      entry.originalUri,
      vscode.Uri.file(filePath),
      label,
      { preview: false }
    );

    this.openDiffFiles.add(filePath);
  }

  private async closeDiffForFile(filePath: string, reopenEditor: boolean = true): Promise<void> {
    const diffTabs: vscode.Tab[] = [];

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

    if (diffTabs.length > 0) {
      try {
        await vscode.window.tabGroups.close(diffTabs, true);
      } catch (error) {
        console.warn(`[PayPilot] Failed to close diff tab for ${filePath}:`, error);
      }
    }

    this.openDiffFiles.delete(filePath);

    const viewColumn = this.diffViewColumns.get(filePath);
    this.diffViewColumns.delete(filePath);

    if (reopenEditor) {
      try {
        await vscode.window.showTextDocument(vscode.Uri.file(filePath), {
          preview: false,
          viewColumn,
        });
      } catch (error) {
        console.warn(`[PayPilot] Unable to reopen editor for ${filePath}:`, error);
      }
    }
  }

  /**
   * Ensure we do not show both the plain editor and the diff for the same file simultaneously.
   */
  private async closePlainEditorForFile(filePath: string): Promise<void> {
    const plainTabs: vscode.Tab[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          if (uri.scheme === 'file' && uri.fsPath === filePath) {
            plainTabs.push(tab);
          }
        }
      }
    }

    if (plainTabs.length > 0) {
      try {
        await vscode.window.tabGroups.close(plainTabs, true);
      } catch (error) {
        console.warn(`[PayPilot] Failed to close editor tab for ${filePath}:`, error);
      }
    }
  }

  /**
   * Single-file undo that replays the captured baseline and optionally reopens the editor.
   */
  private async undoFile(filePath: string, reopenEditor: boolean = true): Promise<void> {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    await this.closeDiffForFile(filePath, false);

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

    if (reopenEditor) {
      await vscode.window.showTextDocument(document, { preview: false });
    }

    this.removeTrackedFile(filePath);
  }

  /**
   * House-keeping when a file leaves the diff queue: forget it locally and persist the new state.
   */
  private removeTrackedFile(filePath: string): void {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    this.trackedFiles.delete(filePath);
    this.openDiffFiles.delete(filePath);
    this.diffViewColumns.delete(filePath);
    this.originalContentProvider.clearOriginalContent(entry.originalUri);
    void this.persistTrackedFiles();
  }

  /**
   * Helper so other services can refresh the CTA state without poking private methods.
   */
  refreshStatusBarButtons(): void {
    this.updateStatusBarButtons();
  }

  /**
   * Reflect the latest diff state in the status bar buttons.
   */
  private updateStatusBarButtons(): void {
    const activeFilePath = this.getActiveTrackedFilePath();
    const currentFileHasChanges = !!activeFilePath;
    const currentFileDiffOpen = activeFilePath ? this.openDiffFiles.has(activeFilePath) : false;

    this.statusBarService.showEnhancedDiffButtons(
      this.hasChanges(),
      currentFileHasChanges,
      this.trackedFiles.size,
      currentFileDiffOpen
    );
  }

  /**
   * Resolve the active editor to a tracked file path if it is under PayPilot control.
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
   * Normalise the synthetic URI we use for baseline documents.
   */
  private toOriginalUri(filePath: string): vscode.Uri {
    return vscode.Uri.file(filePath).with({ scheme: 'paypilot-original', query: '', fragment: '' });
  }

  /**
   * Convenience for user-facing messages where a bare filename reads better.
   */
  private getFileName(filePath: string): string {
    return path.basename(filePath);
  }
}
