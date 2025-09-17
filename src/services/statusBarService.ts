import * as vscode from "vscode";

/**
 * Interface for status bar button configuration
 */
export interface StatusBarButtonConfig {
  text: string;
  command: string;
  tooltip: string;
  priority: number;
  backgroundColor?: vscode.ThemeColor;
}

/**
 * Service class for managing PayPilot related status bar items.
 */
export class StatusBarService {
  private acceptAllButton: vscode.StatusBarItem | undefined;
  private rejectAllButton: vscode.StatusBarItem | undefined;
  private keepButton: vscode.StatusBarItem | undefined;
  private undoButton: vscode.StatusBarItem | undefined;
  private sequentialProgressItem: vscode.StatusBarItem | undefined;
  private chatPanelVisible = false;

  setChatPanelVisibility(visible: boolean): void {
    this.chatPanelVisible = visible;
    if (!visible) {
      this.cleanupStatusBarItems();
    }
  }

  showEnhancedDiffButtons(
    hasAnyChanges: boolean,
    currentFileHasChanges: boolean,
    totalFileCount: number
  ): void {
    if (!this.chatPanelVisible || !hasAnyChanges) {
      this.cleanupStatusBarItems();
      return;
    }

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
      this.keepButton = this.createStatusBarButton({
        text: "$(check) Keep",
        command: "paypilot.keepCurrentFile",
        tooltip: "Keep PayPilot changes in the active file",
        priority: 2001,
        backgroundColor: new vscode.ThemeColor("statusBarItem.prominentBackground"),
      });

      this.undoButton = this.createStatusBarButton({
        text: "$(discard) Undo",
        command: "paypilot.undoCurrentFile",
        tooltip: "Undo PayPilot changes in the active file",
        priority: 2000,
        backgroundColor: new vscode.ThemeColor("statusBarItem.errorBackground"),
      });
    } else {
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

  showProgress(message: string): vscode.StatusBarItem {
    const progressItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1998
    );
    progressItem.text = `$(loading~spin) ${message}`;
    progressItem.tooltip = "PayPilot operation in progress";
    progressItem.show();
    return progressItem;
  }

  hideProgress(progressItem: vscode.StatusBarItem): void {
    progressItem.dispose();
  }

  showSequentialProgress(message: string, current: number, total: number): void {
    if (this.sequentialProgressItem) {
      this.sequentialProgressItem.dispose();
    }

    this.sequentialProgressItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1997
    );
    this.sequentialProgressItem.text = `$(diff) ${message}`;
    this.sequentialProgressItem.tooltip = `Sequential diff review: ${current} of ${total} files`;
    this.sequentialProgressItem.show();
  }

  hideSequentialProgress(): void {
    if (this.sequentialProgressItem) {
      this.sequentialProgressItem.dispose();
      this.sequentialProgressItem = undefined;
    }
  }

  showTemporaryMessage(message: string, duration: number = 3000): void {
    const item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1996
    );
    item.text = message;
    item.show();

    setTimeout(() => item.dispose(), duration);
  }

  createCustomButton(config: StatusBarButtonConfig): vscode.StatusBarItem {
    return this.createStatusBarButton({
      text: config.text,
      command: config.command,
      tooltip: config.tooltip,
      priority: config.priority,
      backgroundColor: config.backgroundColor,
    });
  }

  cleanupStatusBarItems(): void {
    this.cleanupDiffButtons();
    if (this.sequentialProgressItem) {
      this.sequentialProgressItem.dispose();
      this.sequentialProgressItem = undefined;
    }
  }

  dispose(): void {
    this.cleanupStatusBarItems();
  }

  private cleanupDiffButtons(): void {
    if (this.acceptAllButton) {
      this.acceptAllButton.dispose();
      this.acceptAllButton = undefined;
    }
    if (this.rejectAllButton) {
      this.rejectAllButton.dispose();
      this.rejectAllButton = undefined;
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
