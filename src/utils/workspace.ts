import * as vscode from "vscode";

/**
 * Shared workspace utilities for PayPilot extension.
 * Consolidated from previous toolUtils and workspace modules.
 */

/**
 * Gets the primary workspace root URI.
 * PayPilot operates within the context of a single workspace folder.
 * @returns The URI of the primary workspace folder
 * @throws Error if no workspace folder is open
 */
export function getWorkspaceRoot(): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("Open a workspace folder before invoking this tool.");
  }
  return folders[0].uri;
}

/**
 * Gets all workspace folders with validation.
 * @param message - Custom error message if no workspace is open
 * @returns Array of workspace folders
 * @throws Error if no workspace folder is open
 */
export function requireWorkspaceFolders(message?: string): readonly vscode.WorkspaceFolder[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error(message ?? "Open a workspace folder before invoking this tool.");
  }
  return folders;
}

/**
 * Converts an absolute URI to a workspace-relative path.
 * Uses VS Code's built-in asRelativePath for consistent formatting.
 * @param uri - The absolute URI to convert
 * @returns A workspace-relative path (e.g., "src/components/Button.tsx")
 */
export function getRelativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri);
}

/**
 * Legacy alias for getRelativePath for backward compatibility.
 * @deprecated Use getRelativePath instead
 */
export function relativeUriPath(uri: vscode.Uri): string {
  return getRelativePath(uri);
}

/**
 * Resolves a relative path to an absolute workspace URI.
 * This is the primary security boundary for workspace operations.
 * @param relativePath - The relative path (e.g., "src/file.ts")
 * @returns An absolute URI within the workspace
 * @throws Error if no workspace is open
 */
export function resolveWorkspacePath(relativePath: string): vscode.Uri {
  const workspaceRoot = getWorkspaceRoot();
  return vscode.Uri.joinPath(workspaceRoot, relativePath);
}

/**
 * Legacy function that handles both relative and absolute paths.
 * @deprecated Use resolveWorkspacePath for new code
 */
export function resolveWorkspaceUri(candidate: string, message?: string): vscode.Uri {
  const folders = requireWorkspaceFolders(message);

  // Handle URI format
  if (candidate.startsWith("file:")) {
    const uri = vscode.Uri.parse(candidate);
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      throw new Error("The provided URI is outside the current workspace.");
    }
    return uri;
  }

  // Handle absolute paths
  if (candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate)) {
    const absoluteUri = vscode.Uri.file(candidate);
    const owningFolder = vscode.workspace.getWorkspaceFolder(absoluteUri);
    if (!owningFolder || !isWithinWorkspaceRoot(owningFolder.uri, absoluteUri)) {
      throw new Error("The provided path is outside the current workspace.");
    }
    return absoluteUri;
  }

  // Handle relative paths - use the simpler approach
  return resolveWorkspacePath(candidate);
}

/**
 * Validates that a file path is safe for workspace operations.
 * Performs security validation to prevent malicious path manipulation.
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
 * Checks if a candidate URI is within a workspace root.
 * @param parent - The workspace root URI
 * @param candidate - The URI to check
 * @returns True if candidate is within the workspace root
 */
export function isWithinWorkspaceRoot(parent: vscode.Uri, candidate: vscode.Uri): boolean {
  const parentPath = parent.fsPath;
  const candidatePath = candidate.fsPath;
  
  // Normalize paths for comparison
  const normalizedParent = parentPath.replace(/[\\/]+$/, "");
  const normalizedCandidate = candidatePath;
  
  // Check if candidate starts with parent path
  if (normalizedCandidate === normalizedParent) {
    return true;
  }
  
  return normalizedCandidate.startsWith(normalizedParent + "/") || 
         normalizedCandidate.startsWith(normalizedParent + "\\");
}

/**
 * Creates a successful tool result with text content.
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
 * @param error - The error object, message, or unknown error type
 * @returns A formatted error tool result
 */
export function toToolError(error: unknown): vscode.LanguageModelToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return toToolResult(`Error: ${message}`);
}

/**
 * Formats file size in human-readable format.
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
