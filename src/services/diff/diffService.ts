import * as vscode from "vscode";
import { StatusBarService } from "../statusBarService";
import { OriginalContentProvider } from "./originalContentProvider";
import { PayPilotQuickDiffProvider } from "./paypilotQuickDiffProvider";

/**
 * Snapshot of a file tracked for AI modifications.
 * `originalUri` points to the virtual document containing the preserved baseline.
 */
interface TrackedFile {
  readonly originalUri: vscode.Uri;
  readonly originalContent: string;
}

/**
 * Orchestrates AI diff tracking using VS Code's Quick Diff infrastructure.
 *
 * - Remembers the earliest baseline for each modified file.
 * - Exposes quick actions (keep/undo/accept-all/reject-all).
 * - Registers a QuickDiffProvider so gutter decorations always compare against the baseline.
 */

export class DiffService {
  private readonly trackedFiles = new Map<string, TrackedFile>();
  private readonly originalContentProvider = new OriginalContentProvider();
  private readonly disposables: vscode.Disposable[] = [];
  private sourceControl: vscode.SourceControl | undefined;

  constructor(private readonly statusBarService: StatusBarService) {
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        'paypilot-original',
        this.originalContentProvider
      )
    );

    this.setupQuickDiffProvider();

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

  /**
   * Record the files touched by the latest AI response.
   * When a file appears for the first time we snapshot its original contents;
   * later iterations reuse that earliest baseline.
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
        // Ensure the original content provider keeps serving the preserved snapshot.
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
      this.removeTrackedFile(filePath);
    }

    vscode.window.showInformationMessage(
      `✅ Accepted changes for ${files.length} file${files.length === 1 ? "" : "s"}`
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
      await this.undoFile(filePath);
    }

    vscode.window.showInformationMessage(
      `❌ Rejected changes for ${files.length} file${files.length === 1 ? "" : "s"}`
    );
    this.updateStatusBarButtons();
  }

  async keepCurrentFileChanges(): Promise<void> {
    const filePath = this.getActiveTrackedFilePath();
    if (!filePath) {
      vscode.window.showWarningMessage("No PayPilot changes to keep in the active file");
      return;
    }

    this.removeTrackedFile(filePath);
    vscode.window.showInformationMessage(`✅ Kept changes for ${this.getFileName(filePath)}`);
    this.updateStatusBarButtons();
  }

  async undoCurrentFileChanges(): Promise<void> {
    const filePath = this.getActiveTrackedFilePath();
    if (!filePath) {
      vscode.window.showWarningMessage("No PayPilot changes to undo in the active file");
      return;
    }

    await this.undoFile(filePath);
    vscode.window.showInformationMessage(`❌ Undid changes for ${this.getFileName(filePath)}`);
    this.updateStatusBarButtons();
  }

  getActiveDiffFiles(): string[] {
    return Array.from(this.trackedFiles.keys());
  }

  hasChanges(): boolean {
    return this.trackedFiles.size > 0;
  }

  activeFileHasChanges(): boolean {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return false;
    }
    return this.trackedFiles.has(editor.document.uri.fsPath);
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

  private removeTrackedFile(filePath: string): void {
    const entry = this.trackedFiles.get(filePath);
    if (!entry) {
      return;
    }

    this.trackedFiles.delete(filePath);
    this.originalContentProvider.clearOriginalContent(entry.originalUri);
  }

  private updateStatusBarButtons(): void {
    this.statusBarService.showEnhancedDiffButtons(
      this.hasChanges(),
      this.activeFileHasChanges(),
      this.trackedFiles.size
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
    return vscode.Uri.file(filePath).with({ scheme: "paypilot-original", query: "", fragment: "" });
  }

  private getFileName(filePath: string): string {
    return filePath.split(/[\/]/).pop() || filePath;
  }
}
