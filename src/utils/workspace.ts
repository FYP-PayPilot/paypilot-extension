import * as path from "path";
import * as vscode from "vscode";

const DEFAULT_WORKSPACE_ERROR = "Open a workspace folder before invoking this tool.";

export function requireWorkspaceFolders(message?: string): readonly vscode.WorkspaceFolder[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error(message ?? DEFAULT_WORKSPACE_ERROR);
  }
  return folders;
}

export function resolveWorkspaceUri(candidate: string, message?: string): vscode.Uri {
  const folders = requireWorkspaceFolders(message);

  if (candidate.startsWith("file:")) {
    const uri = vscode.Uri.parse(candidate);
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      throw new Error("The provided URI is outside the current workspace.");
    }
    return uri;
  }

  if (path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) {
    const absoluteUri = vscode.Uri.file(path.normalize(candidate));
    const owningFolder = vscode.workspace.getWorkspaceFolder(absoluteUri);
    if (!owningFolder || !isWithinWorkspaceRoot(owningFolder.uri, absoluteUri)) {
      throw new Error("The provided path is outside the current workspace.");
    }
    return absoluteUri;
  }

  const segments = candidate
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  for (const folder of folders) {
    // Check for duplicate folder names at the boundary
    let adjustedSegments = segments;
    
    // Get the last segment of the workspace path
    const workspaceBasename = path.basename(folder.uri.fsPath);
    
    // If the first segment matches the workspace folder name, remove it
    if (segments.length > 0 && segments[0] === workspaceBasename) {
      console.log(`[Workspace] Detected duplicate folder '${workspaceBasename}' - removing from path segments`);
      adjustedSegments = segments.slice(1);
    }
    
    const joined = vscode.Uri.joinPath(folder.uri, ...adjustedSegments);
    if (isWithinWorkspaceRoot(folder.uri, joined)) {
      return joined;
    }
  }

  throw new Error(`Path "${candidate}" is outside the current workspace.`);
}

export function relativeUriPath(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return uri.fsPath;
  }
  return path.relative(folder.uri.fsPath, uri.fsPath) || path.basename(uri.fsPath);
}

export function isWithinWorkspaceRoot(parent: vscode.Uri, candidate: vscode.Uri): boolean {
  const relative = path.relative(parent.fsPath, candidate.fsPath);
  if (relative === "") {
    return true;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
