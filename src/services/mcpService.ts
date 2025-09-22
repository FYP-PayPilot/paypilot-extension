import * as vscode from "vscode";
import { McpServerConfig } from "../types/mcp";


/**
 * Minimal coordination layer around VS Code's `mcp.servers` configuration.
 * PayPilot uses this service to auto-configure recommended servers (context7)
 * and to expose the currently registered servers to the chat webview.
 */
export class McpService {
  private enableMcp = false;

  /**
   * Toggle MCP usage inside PayPilot. Currently just records the state so the
   * UI can reflect the user's preference.
   * @param enabled True when MCP-related features should be considered active.
   */
  setEnabled(enabled: boolean): void {
    this.enableMcp = enabled;
    console.log(`[PayPilot] MCP ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Ensure the default context7 MCP server is present in the user's settings.
   * Called during activation so the recommended endpoint is pre-populated.
   * @returns Promise that resolves when the operation completes.
   * @throws Error if the configuration update fails.
   */
  async ensureContext7McpServer(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration("mcp");
      const servers = config.get<Record<string, unknown>>("servers", {});

      if (servers["context7"]) {
        console.log("[PayPilot] context7 MCP server already configured");
        return;
      }

      const context7Server = {
        type: "http",
        url: "https://mcp.context7.com/mcp",
      };

      servers["context7"] = context7Server;
      await config.update("servers", servers, vscode.ConfigurationTarget.Global);
      console.log("[PayPilot] context7 MCP server added successfully");
    } catch (error) {
      console.error("[PayPilot] Error configuring context7 MCP server:", error);
      throw new Error(`Failed to configure context7 MCP server: ${error}`);
    }
  }

  /**
   * Return the MCP servers currently configured in VS Code.
   * Used by the webview to display available endpoints.
   * @returns Array of MCP server definitions.
   */
  getMcpServers(): McpServerConfig[] {
    try {
      const config = vscode.workspace.getConfiguration("mcp");
      const servers = config.get<Record<string, unknown>>("servers", {});

      return Object.entries(servers).map(([name, data]) => ({
        name,
        ...(data as Partial<McpServerConfig>),
      } as McpServerConfig));
    } catch (error) {
      console.error("[PayPilot] Error reading MCP servers:", error);
      return [];
    }
  }

  /**
   * Reset PayPilot's internal MCP toggle. This is invoked during disposal so the next activation starts from a clean slate.
   * @returns void
   */
  reset(): void {
    this.enableMcp = false;
    console.log("[PayPilot] MCP service state reset");
  }
}
