import * as vscode from "vscode";
import { ChatViewProvider } from "./panels/ChatViewProvider";
import { MessageHandlerService } from "./services/messageHandlerService";

// Global services
let messageHandlerService: MessageHandlerService | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log("PayPilot extension is active (VS Code Language Model API)");

  // Initialize services
  messageHandlerService = new MessageHandlerService();

  // Initialize chat view provider
  const chatProvider = new ChatViewProvider(context);

  // Auto-inject context7 MCP server if not already present
  await messageHandlerService.getMcpService().ensureContext7McpServer();

  // Register webview view provider for chat panel into extension context
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "paypilotChatView",
      chatProvider,
      {
        webviewOptions: { retainContextWhenHidden: true }, // Keep chat state when hidden
      }
    )
  );

  // Track chat panel visibility
  chatProvider.onVisibilityChange((visible) => {
    messageHandlerService?.setChatPanelVisibility(visible);
  });

  // Auto-load models when extension starts to enable immediate use
  chatProvider.postMessage({ type: "model:list-request" });

  // Listen for VS Code language model changes and refresh webview
  if (vscode.lm && vscode.lm.onDidChangeChatModels) {
    context.subscriptions.push(
      vscode.lm.onDidChangeChatModels(() => {
        // Notify webview about model changes
        chatProvider.postMessage({ type: "model:list-request" });
      })
    );
  }

  // Register command to open chat view into extension context
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.openChat", async () => {
      await vscode.commands.executeCommand("paypilotChatView.focus"); // Focus chat panel
    })
  );

  // Register diff-related commands
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.openDiff", async () => {
      if (messageHandlerService) {
        // Simple diff flow - always open diff view
        await messageHandlerService.openDiffView();
      }
    })
  );

  // Register command to accept all changes
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.acceptAllChanges", async () => {
      if (messageHandlerService) {
        const diffService = messageHandlerService.getDiffService();
        await diffService.acceptAllChanges();
      }
    })
  );

  // Register command to reject all changes
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.rejectAllChanges", async () => {
      if (messageHandlerService) {
        const diffService = messageHandlerService.getDiffService();
        await diffService.rejectAllChanges();
      }
    })
  );

  // Register command to keep current file changes
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.keepCurrentFile", async () => {
      if (messageHandlerService) {
        const diffService = messageHandlerService.getDiffService();
        await diffService.keepCurrentFileChanges();
      }
    })
  );

  // Register command to undo current file changes
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.undoCurrentFile", async () => {
      if (messageHandlerService) {
        const diffService = messageHandlerService.getDiffService();
        await diffService.undoCurrentFileChanges();
      }
    })
  );

  /**
   * MESSAGE HANDLING SYSTEM - Processes chat messages and AI requests
   */
  chatProvider.onMessage(async (msg: any, panel: any) => {
    if (messageHandlerService) {
      await messageHandlerService.handleMessage(msg, panel);
    }
  });
}

export function deactivate() {
  messageHandlerService?.dispose();
  messageHandlerService = undefined;
}
