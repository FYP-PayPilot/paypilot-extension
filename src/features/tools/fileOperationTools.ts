import * as vscode from "vscode";
import { 
  FileOperationInput, 
  ReadFileInput, 
  UpdateFileInput, 
  DeleteFileInput 
} from "./types";
import { 
  resolveWorkspacePath, 
  toToolResult, 
  toToolError, 
  isValidWorkspacePath,
  formatFileSize 
} from "./toolUtils";


/** PayPilot tool name prefix for consistent naming */
const PARTICIPANT_ID = "paypilot";

/**
 * Registers the file creation tool with VS Code's Language Model API
 * This tool enables AI models to create new files with specified content
 * @param context - VS Code extension context for subscription management
 * @returns The registered file creation tool
 */
export function registerCreateFileTool(
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
          description: 'Relative path for the new file (e.g., "src/components/Button.tsx")',
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
        
        // validate path security before any filesystem operations
        if (!isValidWorkspacePath(path)) {
          return toToolError(`Invalid or unsafe file path: ${path}`);
        }
        
        // get the absolute URI for the new file
        const targetUri = resolveWorkspacePath(path);

        // check if the file already exists to prevent overwriting
        try {
          await vscode.workspace.fs.stat(targetUri);
          return toToolError(`File already exists: ${path}`);
        } catch {
          // File doesn't exist, good to create
        }

        // Convert content to UTF-8 buffer for consistent encoding
        const payload = Buffer.from(contents, "utf8");
        await vscode.workspace.fs.writeFile(targetUri, payload);

        // Provide detailed success feedback with file size
        return toToolResult(`Created ${path} (${formatFileSize(payload.length)})`);
        
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

/**
 * Registers the file reading tool with VS Code's Language Model API.
 * This tool provides secure file content access within workspace boundaries
 * It formats results for optimal AI model consumption with proper markdown
 * structure for syntax highlighting and readability.
 * @param context - VS Code extension context for subscription management
 * @returns The registered file reading tool
 */
export function registerReadFileTool(
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
        
        // Validate path security
        if (!isValidWorkspacePath(path)) {
          return toToolError(`Invalid or unsafe file path: ${path}`);
        }
        
        const uri = resolveWorkspacePath(path);

        // Read file content using VS Code's filesystem API
        const content = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(content).toString("utf8");

        // format result with markdown for better readability for LLMs
        return toToolResult(`### ${path}\n\n\`\`\`\n${text}\n\`\`\``);
        
      } catch (error) {
        return toToolError(`Could not read file "${options.input.path}": ${error}`);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

/**
 * Registers the file update tool with VS Code's Language Model API.
 * This tool enables complete file content replacement with safety checks.
 * @param context - VS Code extension context for subscription management
 * @returns The registered file update tool
 */
export function registerUpdateFileTool(
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
        
        // validate path security
        if (!isValidWorkspacePath(path)) {
          return toToolError(`Invalid or unsafe file path: ${path}`);
        }
        
        const uri = resolveWorkspacePath(path);

        // verify the file exists before attempting update
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          return toToolError(`File does not exist: ${path}`);
        }

        // Perform atomic file update
        const payload = Buffer.from(contents, "utf8");
        await vscode.workspace.fs.writeFile(uri, payload);

        // Provide detailed success feedback
        return toToolResult(`Updated ${path} (${formatFileSize(payload.length)})`);
        
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

/**
 * Registers the file deletion tool with VS Code's Language Model API.
 * This tool provides secure file removal with existence verification.
 * @param context - VS Code extension context for subscription management
 * @returns The registered file deletion tool
 */
export function registerDeleteFileTool(
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
        
        // validate path security
        if (!isValidWorkspacePath(path)) {
          return toToolError(`Invalid or unsafe file path: ${path}`);
        }
        
        const uri = resolveWorkspacePath(path);

        // verify the file exists before attempting deletion
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          return toToolError(`File does not exist: ${path}`);
        }

        // perform file deletion
        await vscode.workspace.fs.delete(uri);

        // provide success feedback to LLM
        return toToolResult(`Deleted ${path}`);
        
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}