import * as vscode from "vscode";
import { McpService } from "../mcpService";

/**
 * Handles MCP-related webview requests by delegating to McpService.
 * Called from MessageHandlerService when MCP messages are received.
 */
export class McpMessageService {
  constructor(private readonly mcpService: McpService) {}

  /**
   * Toggle MCP enablement based on a webview request.
   * Called from MessageHandlerService when the webview signals a toggle.
   * @param enabled True when MCP-related features should be considered active.
   */
  toggle(enabled: boolean): void {
    this.mcpService.setEnabled(enabled);
  }

  /**
   * Send the configured MCP servers back to the chat webview.
   * Called from MessageHandlerService when the webview signals it's ready to receive them.
   * @param panel The webview panel to send the message to.
   * @returns Promise that resolves when the operation completes.
   */
  async sendServers(panel: vscode.Webview): Promise<void> {
    try {
      const servers = this.mcpService.getMcpServers();
      panel.postMessage({ type: "mcp:servers", servers });
    } catch (error) {
      console.error("Error getting MCP servers:", error);
      panel.postMessage({
        type: "chat:error",
        error: "Failed to load MCP servers",
      });
    }
  }
}
