import * as vscode from "vscode";

/**
 * Service class for managing PayPilot related status bar items.
 */
export class StatusBarService {
  private acceptAllButton: vscode.StatusBarItem | undefined;
  private rejectAllButton: vscode.StatusBarItem | undefined;
  private viewDiffButton: vscode.StatusBarItem | undefined;
  private keepButton: vscode.StatusBarItem | undefined;
  private undoButton: vscode.StatusBarItem | undefined;
  private chatPanelVisible = false;

  /**
   * Track whether the chat panel is visible so we only surface buttons when the UI is open.
   * Called from MessageHandlerService.setChatPanelVisibility when the panel toggles.
   * @param visible True when the chat webview is visible.
   */
  setChatPanelVisibility(visible: boolean): void {
    this.chatPanelVisible = visible;
    if (!visible) {
      this.cleanupStatusBarItems();
    }
  }

  /**
   * Render the full PayPilot diff control surface in the status bar.
   * Called from DiffService.updateStatusBarButtons whenever tracked-file state changes.
   * @param hasAnyChanges True when there are tracked edits across the workspace.
   * @param currentFileHasChanges True when the active editor corresponds to a tracked file.
   * @param totalFileCount Count of tracked files, shown on Accept/Reject All buttons.
   * @param currentFileDiffOpen True when the active file already has a diff tab open.
   */
  showEnhancedDiffButtons(
    hasAnyChanges: boolean,
    currentFileHasChanges: boolean,
    totalFileCount: number,
    currentFileDiffOpen: boolean
  ): void {
    if (!this.chatPanelVisible || !hasAnyChanges) {
      this.cleanupStatusBarItems();
      return;
    }

    // Reset any existing PayPilot buttons so we render a fresh set that reflects current state.
    this.cleanupDiffButtons();

    this.acceptAllButton = this.createStatusBarButton({
      text: `$(check-all) Accept All (${totalFileCount})`,
      command: "paypilot.acceptAllChanges",
      tooltip: totalFileCount === 1
        ? "Accept PayPilot changes in the modified file"
        : `Accept PayPilot changes in ${totalFileCount} files`,
      priority: 2003,
      backgroundColor: new vscode.ThemeColor("statusBarItem.prominentBackground"),
    });

    this.rejectAllButton = this.createStatusBarButton({
      text: `$(discard) Reject All (${totalFileCount})`,
      command: "paypilot.rejectAllChanges",
      tooltip: totalFileCount === 1
        ? "Reject PayPilot changes in the modified file"
        : `Reject PayPilot changes in ${totalFileCount} files`,
      priority: 2002,
      backgroundColor: new vscode.ThemeColor("statusBarItem.errorBackground"),
    });

    if (currentFileHasChanges) {
      // Active editor belongs to a tracked file, so surface per-file actions.
      this.viewDiffButton = this.createStatusBarButton({
        text: currentFileDiffOpen ? "$(x) Close Diff" : "$(diff) View Diff",
        command: "paypilot.toggleCurrentDiff",
        tooltip: currentFileDiffOpen ? "Close PayPilot diff view" : "Open PayPilot diff view",
        priority: 2001,
      });

      this.keepButton = this.createStatusBarButton({
        text: "$(check) Keep",
        command: "paypilot.keepCurrentFile",
        tooltip: "Keep PayPilot changes in the active file",
        priority: 2000,
        backgroundColor: new vscode.ThemeColor("statusBarItem.prominentBackground"),
      });

      this.undoButton = this.createStatusBarButton({
        text: "$(discard) Undo",
        command: "paypilot.undoCurrentFile",
        tooltip: "Undo PayPilot changes in the active file",
        priority: 1999,
        backgroundColor: new vscode.ThemeColor("statusBarItem.errorBackground"),
      });
    } else {
      // No tracked changes in the active editor, ensure per-file buttons are cleared.
      if (this.viewDiffButton) {
        this.viewDiffButton.dispose();
        this.viewDiffButton = undefined;
      }
      if (this.keepButton) {
        this.keepButton.dispose();
        this.keepButton = undefined;
      }
      if (this.undoButton) {
        this.undoButton.dispose();
        this.undoButton = undefined;
      }
    }
  }


  /**
   * Dispose every PayPilot-specific status bar item.
   * Called internally when the chat panel is hidden or there are no tracked changes.
   * Also called from dispose() to clean up when the extension is deactivated.
   * @returns void
   */
  cleanupStatusBarItems(): void {
    this.cleanupDiffButtons();
  }

  /**
   * Dispose the service and the items it manages.
   * Called from the extension deactivation handler.
   * @returns void
   */
  dispose(): void {
    this.cleanupStatusBarItems();
  }

  /**
   * Helper to dispose of every tracked button reference so we do not leak items.
   * Called internally when the chat panel is hidden or there are no tracked changes.
   * @returns void
   */
  private cleanupDiffButtons(): void {
    if (this.acceptAllButton) {
      this.acceptAllButton.dispose();
      this.acceptAllButton = undefined;
    }
    if (this.rejectAllButton) {
      this.rejectAllButton.dispose();
      this.rejectAllButton = undefined;
    }
    if (this.viewDiffButton) {
      this.viewDiffButton.dispose();
      this.viewDiffButton = undefined;
    }
    if (this.keepButton) {
      this.keepButton.dispose();
      this.keepButton = undefined;
    }
    if (this.undoButton) {
      this.undoButton.dispose();
      this.undoButton = undefined;
    }
  }

  /**
   * Factory for standardised status bar buttons used by PayPilot.
   * Called internally to create each button instance.
   * @param config Label, command, tooltip, and priority for the button.
   * @returns The created and shown StatusBarItem instance.
   */
  private createStatusBarButton(config: {
    text: string;
    command: string;
    tooltip: string;
    priority: number;
    backgroundColor?: vscode.ThemeColor;
  }): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      config.priority
    );

    item.text = config.text;
    item.command = config.command;
    item.tooltip = config.tooltip;

    if (config.backgroundColor) {
      item.backgroundColor = config.backgroundColor;
    }

    item.show();
    return item;
  }
}
