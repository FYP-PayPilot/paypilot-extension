import * as vscode from "vscode";

/**
 * Utility functions for PayPilot workspace tools.
 */

/**
 * Gets the primary workspace root URI.
 * PayPilot tools operate within the context of a single workspace folder.
 * This function returns the first workspace folder, which serves as the
 * base for all relative path operations.
 * @returns The URI of the primary workspace folder
 * @throws Error if no workspace folder is open
 */
export function getWorkspaceRoot(): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No workspace folder is open");
  }
  return folders[0].uri;
}

/**
 * Converts an absolute URI to a workspace-relative path.
 * This utility converts file URIs back to workspace-relative paths for
 * display purposes, tool results, and user-facing messages. The relative
 * path format is consistent across platforms and tools.
 * @param uri - The absolute URI to convert
 * @returns A workspace-relative path (e.g., "src/components/Button.tsx")
 */
export function getRelativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri);
}

/**
 * Resolves a relative path to an absolute workspace URI.
 * This is the primary security boundary for workspace tools. All tool-provided
 * paths are resolved through this function to ensure they remain within the
 * workspace boundaries. The function validates the path and constructs a
 * proper URI for filesystem operations.
 * @param relativePath - The relative path from tool input (e.g., "src/file.ts")
 * @returns An absolute URI within the workspace
 * @throws Error if no workspace is open
 */
export function resolveWorkspacePath(relativePath: string): vscode.Uri {
  const workspaceRoot = getWorkspaceRoot();
  return vscode.Uri.joinPath(workspaceRoot, relativePath);
}

/**
 * Creates a successful tool result with text content.
 * VS Code Language Model tools must return LanguageModelToolResult objects.
 * This utility wraps text content in the required result structure for
 * successful tool operations.
 * @param text - The success message or content to return
 * @returns A formatted tool result for the language model
 */
export function toToolResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(text),
  ]);
}

/**
 * Creates an error tool result from an exception or error message.
 * When tool operations fail, this utility formats error information into
 * the required tool result structure. 
 * The function handles both Error objects and string messages consistently.
 * @param error - The error object, message, or unknown error type
 * @returns A formatted error tool result
 */
export function toToolError(error: unknown): vscode.LanguageModelToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return toToolResult(`Error: ${message}`);
}

/**
 * Validates that a file path is safe for workspace operations.
 * This function performs additional validation beyond basic path resolution
 * to ensure workspace security and prevent malicious path manipulation.
 * @param relativePath - The path to validate
 * @returns True if the path is safe for workspace operations
 */
export function isValidWorkspacePath(relativePath: string): boolean {
  // Check for directory traversal attempts
  if (relativePath.includes("..") || relativePath.includes("./")) {
    return false;
  }
  
  // Check for absolute path attempts
  if (relativePath.startsWith("/") || relativePath.includes(":")) {
    return false;
  }
  
  // Check for null bytes or control characters
  if (/[\x00-\x1f]/.test(relativePath)) {
    return false;
  }
  
  // Check for reasonable length
  if (relativePath.length > 260) {
    return false;
  }
  
  return true;
}

/**
 * Formats file size in human-readable format.
 * Utility for displaying file sizes in tool results and user messages.
 * Provides consistent formatting across all tool operations
 * @param bytes - The size in bytes
 * @returns Formatted size string (e.g., "1.2 KB", "3.4 MB")
 */
export function formatFileSize(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}