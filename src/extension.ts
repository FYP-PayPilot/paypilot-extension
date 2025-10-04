import * as vscode from "vscode";
import { ChatViewProvider } from "./panels/ChatViewProvider";
import { MessageHandlerService } from "./features/chat/messageHandlerService";
import { registerPaypilotTools } from "./tools";
import { ToolExecutionServer } from "./features/tool-execution/toolExecutionServer";

let messageHandlerService: MessageHandlerService | undefined; // global message handler service
let toolServer: ToolExecutionServer | undefined;

/**
 * Entrypoint for the PayPilot extension. Wires up the chat panel, commands,
 * and long-lived services.
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log("PayPilot extension is active");

  const { chatTools } = registerPaypilotTools(context);

  // Spin up the coordinator that owns diff/context/mcp services.
  messageHandlerService = new MessageHandlerService(
    context.workspaceState,
    chatTools
  );

  // Start tool execution server
  toolServer = new ToolExecutionServer();
  try {
    await toolServer.start(3001);
    vscode.window.showInformationMessage(
      `PayPilot tool server running on port ${toolServer.getPort()}`
    );
  } catch (error) {
    console.error("[PayPilot] Failed to start tool server:", error);
    vscode.window.showErrorMessage("Failed to start PayPilot tool server");
  }
  context.subscriptions.push({
    dispose: () => toolServer?.dispose()
  });

  const chatProvider = new ChatViewProvider(context);

  // Ensure the recommended context7 MCP server is registered in user settings.
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

  // Relay visibility so the status bar buttons only appear when the panel is open.
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

  // Register command to open the chat view.
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.openChat", async () => {
      await vscode.commands.executeCommand("paypilotChatView.focus");
    })
  );

  // Register diff-related commands
  context.subscriptions.push(
    // Diff commands always go through the service so status buttons stay in sync.
    vscode.commands.registerCommand("paypilot.openDiff", async () => {
      if (messageHandlerService) {
        // Simple diff flow - always open diff view
        await messageHandlerService.openDiffView();
      }
    })
  );

  // Diff-related commands always go through the service so state stays in sync with the status bar.
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.acceptAllChanges", async () => {
      if (messageHandlerService) {
        const diffService = messageHandlerService.getDiffService();
        await diffService.acceptAllChanges();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.rejectAllChanges", async () => {
      if (messageHandlerService) {
        const diffService = messageHandlerService.getDiffService();
        await diffService.rejectAllChanges();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.keepCurrentFile", async () => {
      if (messageHandlerService) {
        const diffService = messageHandlerService.getDiffService();
        await diffService.keepCurrentFileChanges();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.undoCurrentFile", async () => {
      if (messageHandlerService) {
        const diffService = messageHandlerService.getDiffService();
        await diffService.undoCurrentFileChanges();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.toggleCurrentDiff", async () => {
      if (messageHandlerService) {
        const diffService = messageHandlerService.getDiffService();
        await diffService.toggleDiffForActiveFile();
      }
    })
  );

  // Bridge the webview messages back into the message handler.
  chatProvider.onMessage(async (msg: unknown, panel: vscode.Webview) => {
    if (messageHandlerService) {
      await messageHandlerService.handleMessage(msg, panel);
    }
  });
}

/**
 * VS Code deactivation hook. Disposes long-lived services so they can clean up.
 */
export function deactivate(): void {
  toolServer?.dispose();
  messageHandlerService?.dispose();
  messageHandlerService = undefined;
}
