import * as vscode from "vscode";

/**
 * Implements QuickDiffProvider VSCode API to provide original resources for diffing.
 */
export class PayPilotQuickDiffProvider implements vscode.QuickDiffProvider {
  constructor(private readonly getOriginalResource: (uri: vscode.Uri) => vscode.Uri | undefined) {}

  /**
   * Provides the original resource URI for a given modified resource URI.
   * Called by VS Code when a diff view is opened.
   * @param uri The modified resource URI
   * @param token Cancellation token
   * @returns The original resource URI or undefined if not available
   */
  provideOriginalResource(
    uri: vscode.Uri,
    token?: vscode.CancellationToken
  ): vscode.Uri | undefined {
    if (token?.isCancellationRequested) {
      return undefined;
    }

    return this.getOriginalResource(uri);
  }
}
