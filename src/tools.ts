import * as vscode from "vscode";

const PARTICIPANT_ID = "paypilot";

// Minimal interfaces - only what's absolutely necessary
interface WorkspaceContextInput {
  glob?: string;
  maxFiles?: number;
  includeText?: boolean;
}

interface FileOperationInput {
  path: string;
  contents?: string;
}

interface UpdateFileInput {
  path: string;
  contents: string;
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

interface DeleteDirectoryInput {
  path: string;
}

export interface PaypilotToolset {
  chatTools: vscode.LanguageModelChatTool[];
}

// Utility functions - keep it simple
function getWorkspaceRoot(): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No workspace folder is open");
  }
  return folders[0].uri;
}

function getRelativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri);
}

function resolveWorkspacePath(relativePath: string): vscode.Uri {
  const workspaceRoot = getWorkspaceRoot();
  return vscode.Uri.joinPath(workspaceRoot, relativePath);
}

function toToolResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(text),
  ]);
}

function toToolError(error: unknown): vscode.LanguageModelToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return toToolResult(`Error: ${message}`);
}

export function registerPaypilotTools(
  context: vscode.ExtensionContext
): PaypilotToolset {
  const tools: vscode.LanguageModelChatTool[] = [];

  // Register full CRUD operations + Directory management
  tools.push(registerWorkspaceContextTool(context)); // DISCOVER
  tools.push(registerCreateFileTool(context)); // CREATE FILE
  tools.push(registerReadFileTool(context)); // READ FILE
  tools.push(registerUpdateFileTool(context)); // UPDATE FILE
  tools.push(registerDeleteFileTool(context)); // DELETE FILE
  tools.push(registerCreateDirectoryTool(context)); // CREATE DIRECTORY
  tools.push(registerDeleteDirectoryTool(context)); // DELETE DIRECTORY

  return { chatTools: tools };
}

// 1. WORKSPACE CONTEXT TOOL - Uses vscode.workspace.findFiles optimally
function registerWorkspaceContextTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-workspaceContext`,
    description:
      "Discover files and analyze workspace structure using glob patterns",
    inputSchema: {
      type: "object",
      properties: {
        glob: {
          type: "string",
          description:
            'Glob pattern to find files (e.g., "**/*.js", "src/**/*")',
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

  const disposable = vscode.lm.registerTool<WorkspaceContextInput>(tool.name, {
    async invoke(options, token) {
      try {
        const {
          glob = "**/*",
          maxFiles = 20,
          includeText = true,
        } = options.input;

        // Use vscode.workspace.findFiles - the optimal API
        const files = await vscode.workspace.findFiles(
          glob,
          "**/node_modules/**",
          maxFiles,
          token
        );

        if (files.length === 0) {
          return toToolResult(`No files found matching pattern: ${glob}`);
        }

        const results: string[] = [];
        results.push(`Found ${files.length} files matching "${glob}":\n`);

        for (const file of files) {
          const relativePath = getRelativePath(file);

          if (!includeText) {
            results.push(`- ${relativePath}`);
            continue;
          }

          try {
            const content = await vscode.workspace.fs.readFile(file);
            const text = Buffer.from(content).toString("utf8");
            const truncated =
              text.length > 2000
                ? text.slice(0, 2000) + "\n...(truncated)"
                : text;

            results.push(
              `\n### ${relativePath}\n\`\`\`\n${truncated}\n\`\`\`\n`
            );
          } catch (error) {
            results.push(`- ${relativePath} (could not read)`);
          }
        }

        return toToolResult(results.join("\n"));
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

// 2. CREATE FILE TOOL - Minimal implementation
function registerCreateFileTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-createFile`,
    description: "Create a new file in the workspace",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description:
            'Relative path for the new file (e.g., "src/components/Button.tsx")',
        },
        contents: {
          type: "string",
          description: "File contents",
          default: "",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<FileOperationInput>(tool.name, {
    async invoke(options, _token) {
      try {
        const { path, contents = "" } = options.input;
        const targetUri = resolveWorkspacePath(path);

        // Check if file already exists
        try {
          await vscode.workspace.fs.stat(targetUri);
          return toToolError(`File already exists: ${path}`);
        } catch {
          // File doesn't exist, good to create
        }

        const payload = Buffer.from(contents, "utf8");
        await vscode.workspace.fs.writeFile(targetUri, payload);

        return toToolResult(`✅ Created ${path} (${payload.length} bytes)`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

// 3. READ FILE TOOL - Simple file reading
function registerReadFileTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-readFile`,
    description: "Read contents of a workspace file",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Relative path of file to read",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<ReadFileInput>(tool.name, {
    async invoke(options, _token) {
      try {
        const { path } = options.input;
        const uri = resolveWorkspacePath(path);

        const content = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(content).toString("utf8");

        return toToolResult(`### ${path}\n\n\`\`\`\n${text}\n\`\`\``);
      } catch (error) {
        return toToolError(
          `Could not read file "${options.input.path}": ${error}`
        );
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

// 4. UPDATE FILE TOOL - Simple file updating
function registerUpdateFileTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-updateFile`,
    description: "Update/replace the contents of an existing workspace file",
    inputSchema: {
      type: "object",
      required: ["path", "contents"],
      properties: {
        path: {
          type: "string",
          description: "Relative path of file to update",
        },
        contents: {
          type: "string",
          description: "New file contents (replaces entire file)",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<UpdateFileInput>(tool.name, {
    async invoke(options, _token) {
      try {
        const { path, contents } = options.input;
        const uri = resolveWorkspacePath(path);

        // Check if file exists
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          return toToolError(`File does not exist: ${path}`);
        }

        const payload = Buffer.from(contents, "utf8");
        await vscode.workspace.fs.writeFile(uri, payload);

        return toToolResult(`✅ Updated ${path} (${payload.length} bytes)`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

// 5. DELETE FILE TOOL - Simple file deletion
function registerDeleteFileTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-deleteFile`,
    description: "Delete a file from the workspace",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Relative path of file to delete",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<DeleteFileInput>(tool.name, {
    async invoke(options, _token) {
      try {
        const { path } = options.input;
        const uri = resolveWorkspacePath(path);

        // Check if file exists
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          return toToolError(`File does not exist: ${path}`);
        }

        await vscode.workspace.fs.delete(uri);

        return toToolResult(`✅ Deleted ${path}`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

// 6. CREATE DIRECTORY TOOL - Directory creation
function registerCreateDirectoryTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-createDirectory`,
    description: "Create a directory in the workspace",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description:
            'Relative path of directory to create (e.g., "src/components")',
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<CreateDirectoryInput>(tool.name, {
    async invoke(options, _token) {
      try {
        const { path } = options.input;
        const uri = resolveWorkspacePath(path);

        // Check if directory already exists
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type & vscode.FileType.Directory) {
            return toToolError(`Directory already exists: ${path}`);
          }
        } catch {
          // Directory doesn't exist, good to create
        }

        await vscode.workspace.fs.createDirectory(uri);

        return toToolResult(`✅ Created directory ${path}`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

// 7. DELETE DIRECTORY TOOL - Directory deletion
function registerDeleteDirectoryTool(
  context: vscode.ExtensionContext
): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-deleteDirectory`,
    description: "Delete a directory from the workspace",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Relative path of directory to delete",
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<DeleteDirectoryInput>(tool.name, {
    async invoke(options, _token) {
      try {
        const { path } = options.input;
        const uri = resolveWorkspacePath(path);

        // Check if directory exists and is actually a directory
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (!(stat.type & vscode.FileType.Directory)) {
            return toToolError(`"${path}" is not a directory`);
          }
        } catch {
          return toToolError(`Directory does not exist: ${path}`);
        }

        await vscode.workspace.fs.delete(uri, { recursive: true });

        return toToolResult(`✅ Deleted directory ${path}`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}
