
import * as path from "path";
import * as vscode from "vscode";
import { StatusBarService } from "../statusBarService";
import { OriginalContentProvider } from "./originalContentProvider";
import { PayPilotQuickDiffProvider } from "./paypilotQuickDiffProvider";
import { TrackedFile } from "../../types/diff";

/**
 * Orchestrates AI edit tracking using VS Code's Quick Diff infrastructure.
 * Maintains per-file baselines, drives status-bar actions, and exposes
 * helpers for toggling a full diff view on demand.
 */
export class DiffService {
  private readonly trackedFiles = new Map<string, TrackedFile>();
  private readonly originalContentProvider = new OriginalContentProvider();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly openDiffFiles = new Set<string>();
  private readonly diffViewColumns = new Map<string, vscode.ViewColumn | undefined>();
  private sourceControl: vscode.SourceControl | undefined;

  constructor(private readonly statusBarService: StatusBarService) {
    // Expose preserved baselines under a custom URI scheme so VS Code can load them.
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        'paypilot-original',
        this.originalContentProvider
      )
    );

    // Register a QuickDiffProvider so gutter markers compare against our baselines.
    this.setupQuickDiffProvider();

    // Refresh status-bar buttons whenever focus changes.
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.updateStatusBarButtons();
      })
    );
  }

  private setupQuickDiffProvider(): void {
    const quickDiffProvider = new PayPilotQuickDiffProvider((uri) => {
      const entry = this.trackedFiles.get(uri.fsPath);
      return entry?.originalUri;
    });

    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    this.sourceControl = vscode.scm.createSourceControl('paypilot', 'PayPilot', root);
    this.sourceControl.quickDiffProvider = quickDiffProvider;
    this.disposables.push({ dispose: () => this.sourceControl?.dispose() });
  }

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
  }

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

    this.trackedFiles.clear();
    this.originalContentProvider.dispose();
  }

  private async openDiffForFile(filePath: string): Promise<void> {
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

  private removeTrackedFile(filePath: string): void {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    this.trackedFiles.delete(filePath);
    this.openDiffFiles.delete(filePath);
    this.diffViewColumns.delete(filePath);
    this.originalContentProvider.clearOriginalContent(entry.originalUri);
  }

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

  private getActiveTrackedFilePath(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    const filePath = editor.document.uri.fsPath;
    return this.trackedFiles.has(filePath) ? filePath : undefined;
  }

  private toOriginalUri(filePath: string): vscode.Uri {
    return vscode.Uri.file(filePath).with({ scheme: 'paypilot-original', query: '', fragment: '' });
  }

  private getFileName(filePath: string): string {
    return path.basename(filePath);
  }
}
