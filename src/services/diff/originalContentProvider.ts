
import * as vscode from "vscode";

/**
 * Lightweight content provider that feeds VS Code the original snapshot
 * for any file PayPilot is tracking.
 */
export class OriginalContentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly contentByUri = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentByUri.get(this.key(uri)) ?? "";
  }

  setOriginalContent(uri: vscode.Uri, content: string): void {
    this.contentByUri.set(this.key(uri), content);
    this.onDidChangeEmitter.fire(uri);
  }

  clearOriginalContent(uri: vscode.Uri): void {
    if (this.contentByUri.delete(this.key(uri))) {
      this.onDidChangeEmitter.fire(uri);
    }
  }

  dispose(): void {
    this.contentByUri.clear();
    this.onDidChangeEmitter.dispose();
  }

  private key(uri: vscode.Uri): string {
    return uri.with({ query: "", fragment: "" }).toString();
  }
}
