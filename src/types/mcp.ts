/**
 * Structure representing an MCP server definition from VS Code settings.
 */
export interface McpServerConfig {
  name: string;
  type: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}
