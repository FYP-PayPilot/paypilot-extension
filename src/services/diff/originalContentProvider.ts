import * as vscode from "vscode";

/**
 * TextDocumentContentProvider implementation that stores PayPilot originals in memory.
 */
export class OriginalContentProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;
  private readonly originalContentByUri = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = this.getKey(uri);
    return this.originalContentByUri.get(key) ?? "";
  }

  setOriginalContent(uri: vscode.Uri, content: string): void {
    const key = this.getKey(uri);
    this.originalContentByUri.set(key, content);
    this._onDidChange.fire(uri);
  }

  getOriginalContent(uri: vscode.Uri): string | undefined {
    return this.originalContentByUri.get(this.getKey(uri));
  }

  clearOriginalContent(uri: vscode.Uri): void {
    const key = this.getKey(uri);
    if (this.originalContentByUri.delete(key)) {
      this._onDidChange.fire(uri);
    }
  }

  hasOriginalContent(uri: vscode.Uri): boolean {
    return this.originalContentByUri.has(this.getKey(uri));
  }

  update(uri: vscode.Uri): void {
    if (this.hasOriginalContent(uri)) {
      this._onDidChange.fire(uri);
    }
  }

  clearAll(): void {
    if (this.originalContentByUri.size === 0) {
      return;
    }
    this.originalContentByUri.clear();
  }

  dispose(): void {
    this.originalContentByUri.clear();
    this._onDidChange.dispose();
  }

  private getKey(uri: vscode.Uri): string {
    return uri.with({ query: "", fragment: "" }).toString();
  }
}
