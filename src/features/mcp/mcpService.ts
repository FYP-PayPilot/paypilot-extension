// MCP functionality temporarily disabled via comments.
// import * as vscode from "vscode";
// import { McpServerConfig } from "./types";
// 
// 
// /**
//  * Service to read MCP servers from VS Code configuration.
//  * PayPilot uses this to display available MCP servers in the webview.
//  */
// export class McpService {
//   private enableMcp = false;
// 
//   /**
//    * Toggle MCP usage inside PayPilot. Currently just records the state so the
//    * UI can reflect the user's preference.
//    * @param enabled True when MCP-related features should be considered active.
//    */
//   setEnabled(enabled: boolean): void {
//     this.enableMcp = enabled;
//     console.log(`[PayPilot] MCP ${enabled ? "enabled" : "disabled"}`);
//   }
// 
//   /**
//    * Return the MCP servers currently configured in VS Code.
//    * Used by the webview to display available endpoints.
//    * @returns Array of MCP server definitions.
//    */
//   getMcpServers(): McpServerConfig[] {
//     try {
//       const config = vscode.workspace.getConfiguration("mcp");
//       const servers = config.get<Record<string, unknown>>("servers", {});
// 
//       return Object.entries(servers).map(([name, data]) => ({
//         name,
//         ...(data as Partial<McpServerConfig>),
//       } as McpServerConfig));
//     } catch (error) {
//       console.error("[PayPilot] Error reading MCP servers:", error);
//       return [];
//     }
//   }
// 
//   /**
//    * Check if MCP is currently enabled.
//    * @returns True if MCP features are enabled.
//    */
//   isEnabled(): boolean {
//     return this.enableMcp;
//   }
// 
//   /**
//    * Reset PayPilot's internal MCP toggle. This is invoked during disposal so the next activation starts from a clean slate.
//    * @returns void
//    */
//   reset(): void {
//     this.enableMcp = false;
//     console.log("[PayPilot] MCP service state reset");
//   }
// }
