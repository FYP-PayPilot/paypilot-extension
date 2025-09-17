import * as vscode from "vscode";

/**
 * Quick diff provider that maps file URIs to their preserved baseline.
 */
export class PayPilotQuickDiffProvider implements vscode.QuickDiffProvider {
  constructor(private readonly getOriginalResource: (uri: vscode.Uri) => vscode.Uri | undefined) {}

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
