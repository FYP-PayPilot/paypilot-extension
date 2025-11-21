import * as vscode from "vscode";
import { WorkspaceContextInput } from "./types";
import { getRelativePath, toToolResult, toToolError } from "./toolUtils";

/**
 * PayPilot workspace context discovery tool
 */

/** PayPilot tool name prefix for consistent naming */
const PARTICIPANT_ID = "paypilot";

/**
 * Registers the workspace context discovery tool with VS Code's Language Model API.
 * This tool leverages VS Code's optimized `workspace.findFiles` API for efficient file discovery. 
 * @param context - VS Code extension context for subscription management
 * @returns The registered workspace context tool
 */
export function registerWorkspaceContextTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-workspaceContext`,
    description: "Discover files and analyze workspace structure using glob patterns",
    inputSchema: {
      type: "object",
      properties: {
        glob: {
          type: "string",
          description: 'Glob pattern to find files (e.g., "**/*.js", "src/**/*")',
          default: "**/*",
        },
        maxFiles: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum files to return",
          default: 20,
        },
        includeText: {
          type: "boolean",
          description: "Include file contents in results",
          default: true,
        },
      },
    },
  };

  /**
   * Tool implementation with comprehensive error handling and result formatting.
   */
  const disposable = vscode.lm.registerTool<WorkspaceContextInput>(tool.name, {
    async invoke(options, token) {
      try {
        // Extract parameters with defaults matching the schema
        const {
          glob = "**/*",
          maxFiles = 20,
          includeText = true,
        } = options.input;

        // use vscode's optimized file search API, more efficient than manual traversal
        const files = await vscode.workspace.findFiles(
          glob,
          "**/node_modules/**", // Exclude build artifacts and dependencies
          maxFiles,
          token // Support cancellation for long-running operations
        );

        // Handle empty results with helpful messaging
        if (files.length === 0) {
          return toToolResult(`No files found matching pattern: ${glob}`);
        }

        // Build structured results for AI model consumption
        const results: string[] = [];
        results.push(`Found ${files.length} files matching "${glob}":\n`);

        // process each file, include contents if requested
        for (const file of files) {
          const relativePath = getRelativePath(file);

          // Structure-only mode: just list file paths
          if (!includeText) {
            results.push(`- ${relativePath}`);
            continue;
          }

          // Content-inclusive mode: read and include file contents
          try {
            const content = await vscode.workspace.fs.readFile(file);
            const text = Buffer.from(content).toString("utf8");
            
            /**
             * Content truncation for token management.
             * 
             * Large files are truncated to prevent token overflow while
             * still providing meaningful context. The truncation point
             * balances usefulness with token economy.
             */
            const truncated = text.length > 2000 
              ? text.slice(0, 2000) + "\n...(truncated)"
              : text;

            // Format content with markdown for better AI model parsing
            results.push(`\n### ${relativePath}\n\`\`\`\n${truncated}\n\`\`\`\n`);
            
          } catch (error) {
            // Graceful degradation: list file even if content unreadable
            results.push(`- ${relativePath} (could not read)`);
          }
        }

        return toToolResult(results.join("\n"));
        
      } catch (error) {
        // Top-level error handling for workspace or API failures
        return toToolError(error);
      }
    },
  });

  // Register for automatic cleanup on extension deactivation
  context.subscriptions.push(disposable);
  return tool;
}