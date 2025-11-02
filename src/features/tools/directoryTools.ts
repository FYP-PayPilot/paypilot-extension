import * as vscode from "vscode";
import { CreateDirectoryInput, DeleteDirectoryInput } from "./types";
import { 
  resolveWorkspacePath, 
  toToolResult, 
  toToolError, 
  isValidWorkspacePath 
} from "./toolUtils";

/** PayPilot tool name prefix for consistent naming */
const PARTICIPANT_ID = "paypilot";

/**
 * Registers the directory creation tool with VS Code's Language Model API.
 * This tool enables AI models to create directory structures within the workspace.
 * @param context - VS Code extension context for subscription management
 * @returns The registered directory creation tool
 */
export function registerCreateDirectoryTool(
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
          description: 'Relative path of directory to create (e.g., "src/components")',
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<CreateDirectoryInput>(tool.name, {
    async invoke(options, _token) {
      try {
        const { path } = options.input;
        
        // validate path before any filesystem operations
        if (!isValidWorkspacePath(path)) {
          return toToolError(`Invalid or unsafe directory path: ${path}`);
        }
        
        const uri = resolveWorkspacePath(path);

        // check if the directory already exists
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type & vscode.FileType.Directory) {
            return toToolError(`Directory already exists: ${path}`);
          } else {
            // something exists at this path but it's not a directory
            return toToolError(`Cannot create directory: file exists at path ${path}`);
          }
        } catch {
            // directory does not exist, so can proceed with creation
        }

        // create the directory, including any necessary parent directories
        await vscode.workspace.fs.createDirectory(uri);

        // return tool result indicating directory creation success
        return toToolResult(`Created directory ${path}`);
        
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

/**
 * Registers the directory deletion tool with VS Code's Language Model API.
 * This tool enables AI models to remove directories and their contents.
 * @param context - VS Code extension context for subscription management
 * @returns The registered directory deletion tool
 */
export function registerDeleteDirectoryTool(
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
        
        // validate path security
        if (!isValidWorkspacePath(path)) {
          return toToolError(`Invalid or unsafe directory path: ${path}`);
        }
        
        // get the full URI for the target directory
        const uri = resolveWorkspacePath(path);

        // verify the directory exists before attempting deletion
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (!(stat.type & vscode.FileType.Directory)) {
            return toToolError(`"${path}" is not a directory`);
          }
        } catch {
          return toToolError(`Directory does not exist: ${path}`);
        }

        // perform recursive deletion of the directory and its contents
        await vscode.workspace.fs.delete(uri, { recursive: true });

        // return tool result indicating successful deletion
        return toToolResult(`Deleted directory ${path}`);
        
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}