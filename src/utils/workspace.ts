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

  const normalized = candidate.replace(/\\/g, "/");
  for (const folder of folders) {
    const joined = vscode.Uri.joinPath(folder.uri, normalized);
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
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
