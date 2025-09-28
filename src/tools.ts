import * as vscode from "vscode";

const PARTICIPANT_ID = "paypilot";

// Simplified interfaces - focus on core functionality
interface WorkspaceContextInput {
  glob?: string;
  maxFiles?: number;
  includeText?: boolean;
}

interface CreateFileInput {
  path: string;
  content?: string;
}

interface UpdateFileInput {
  path: string;
  content: string;
}

interface DeleteFileInput {
  path: string;
}

interface ReadFileInput {
  path: string;
}

interface CreateDirectoryInput {
  path: string;
}

interface MoveFileInput {
  sourcePath: string;
  targetPath: string;
}

export interface PaypilotToolset {
  chatTools: vscode.LanguageModelChatTool[];
}

// Helper to get workspace URI - simple and reliable
function getWorkspaceUri(relativePath: string): vscode.Uri {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error("No workspace folder is open");
  }

  // Clean up path - remove leading slashes, normalize separators
  const cleanPath = relativePath.replace(/^[\/\\]+/, "").replace(/\\/g, "/");
  return vscode.Uri.joinPath(workspaceFolder.uri, cleanPath);
}

export function registerPaypilotTools(
  context: vscode.ExtensionContext
): PaypilotToolset {
  const tools: vscode.LanguageModelChatTool[] = [];

  // Register all tools
  tools.push(registerWorkspaceContextTool(context));
  tools.push(registerCreateFileTool(context));
  tools.push(registerUpdateFileTool(context));
  tools.push(registerDeleteFileTool(context));
  tools.push(registerReadFileTool(context));
  tools.push(registerCreateDirectoryTool(context));
  tools.push(registerMoveFileTool(context));

  return { chatTools: tools };
}

function registerWorkspaceContextTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-workspaceContext`,
    description:
      "Get information about the workspace files and folders. Use this to discover file paths and understand project structure.",
    inputSchema: {
      type: "object",
      properties: {
        glob: {
          type: "string",
          description:
            'Glob pattern to search for files (e.g. "**/*.ts", "src/**/*.js"). If not provided, lists all files.',
        },
        maxFiles: {
          type: "number",
          description: "Maximum number of files to return. Default is 50.",
        },
        includeText: {
          type: "boolean",
          description:
            "Whether to include file contents in the response. Default is false.",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool(tool.name, {
    async invoke(options) {
      try {
        const {
          glob = "**/*",
          maxFiles = 50,
          includeText = false,
        } = options.input as WorkspaceContextInput;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart("❌ No workspace folder is open"),
          ]);
        }

        // Use vscode.workspace.findFiles for file discovery
        const files = await vscode.workspace.findFiles(glob, null, maxFiles);

        if (files.length === 0) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `No files found matching pattern: ${glob}`
            ),
          ]);
        }

        let result = `## Workspace Files (${files.length})\n\n`;

        for (const file of files) {
          const relativePath = vscode.workspace.asRelativePath(file);
          result += `- ${relativePath}\n`;

          if (includeText) {
            try {
              const content = await vscode.workspace.fs.readFile(file);
              const text = Buffer.from(content).toString("utf8");
              const truncated =
                text.length > 1000 ? text.slice(0, 1000) + "..." : text;
              result += `  \`\`\`\n${truncated}\n  \`\`\`\n\n`;
            } catch (error) {
              result += `  (Could not read file: ${
                error instanceof Error ? error.message : "Unknown error"
              })\n\n`;
            }
          }
        }

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(result),
        ]);
      } catch (error) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ Error: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          ),
        ]);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerCreateFileTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-createFile`,
    description:
      "Create a new file in the workspace with the specified content.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description:
            "Relative path from workspace root (e.g., src/components/Button.tsx)",
        },
        content: {
          type: "string",
          description: "File content to write. Defaults to empty string.",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool(tool.name, {
    async invoke(options) {
      try {
        const { path: relativePath, content = "" } =
          options.input as CreateFileInput;
        const uri = getWorkspaceUri(relativePath);

        // Create parent directories if needed
        const parentDir = vscode.Uri.joinPath(uri, "..");
        await vscode.workspace.fs.createDirectory(parentDir);

        // Write file
        const buffer = Buffer.from(content, "utf8");
        await vscode.workspace.fs.writeFile(uri, buffer);

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`✅ Created file: ${relativePath}`),
        ]);
      } catch (error) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ Error creating file: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          ),
        ]);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerUpdateFileTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-updateFile`,
    description: "Update or replace the entire content of an existing file.",
    inputSchema: {
      type: "object",
      required: ["path", "content"],
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root",
        },
        content: {
          type: "string",
          description: "New file content that will replace the entire file",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool(tool.name, {
    async invoke(options) {
      try {
        const { path: relativePath, content } =
          options.input as UpdateFileInput;
        const uri = getWorkspaceUri(relativePath);

        // Check if file exists
        await vscode.workspace.fs.stat(uri);

        // Write new content
        const buffer = Buffer.from(content, "utf8");
        await vscode.workspace.fs.writeFile(uri, buffer);

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`✅ Updated file: ${relativePath}`),
        ]);
      } catch (error) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ Error updating file: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          ),
        ]);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerReadFileTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-readFile`,
    description: "Read the contents of a file in the workspace.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool(tool.name, {
    async invoke(options) {
      try {
        const { path: relativePath } = options.input as ReadFileInput;
        const uri = getWorkspaceUri(relativePath);

        const content = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(content).toString("utf8");

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `### ${relativePath}\n\n\`\`\`\n${text}\n\`\`\``
          ),
        ]);
      } catch (error) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ Error reading file: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          ),
        ]);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerDeleteFileTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-deleteFile`,
    description: "Delete a file or directory in the workspace.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool(tool.name, {
    async invoke(options) {
      try {
        const { path: relativePath } = options.input as DeleteFileInput;
        const uri = getWorkspaceUri(relativePath);

        await vscode.workspace.fs.delete(uri, { recursive: true });

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`✅ Deleted: ${relativePath}`),
        ]);
      } catch (error) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ Error deleting: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          ),
        ]);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerCreateDirectoryTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-createDirectory`,
    description: "Create a directory in the workspace.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool(tool.name, {
    async invoke(options) {
      try {
        const { path: relativePath } = options.input as CreateDirectoryInput;
        const uri = getWorkspaceUri(relativePath);

        await vscode.workspace.fs.createDirectory(uri);

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `✅ Created directory: ${relativePath}`
          ),
        ]);
      } catch (error) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ Error creating directory: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          ),
        ]);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerMoveFileTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-moveFile`,
    description: "Move or rename a file or directory in the workspace.",
    inputSchema: {
      type: "object",
      required: ["sourcePath", "targetPath"],
      properties: {
        sourcePath: {
          type: "string",
          description: "Current relative path from workspace root",
        },
        targetPath: {
          type: "string",
          description: "New relative path from workspace root",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool(tool.name, {
    async invoke(options) {
      try {
        const { sourcePath, targetPath } = options.input as MoveFileInput;
        const sourceUri = getWorkspaceUri(sourcePath);
        const targetUri = getWorkspaceUri(targetPath);

        // Create parent directory for target if needed
        const parentDir = vscode.Uri.joinPath(targetUri, "..");
        await vscode.workspace.fs.createDirectory(parentDir);

        // Use workspace.fs.rename for moving
        await vscode.workspace.fs.rename(sourceUri, targetUri, {
          overwrite: false,
        });

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `✅ Moved ${sourcePath} → ${targetPath}`
          ),
        ]);
      } catch (error) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ Error moving file: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          ),
        ]);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}
