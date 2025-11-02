// Re-export consolidated workspace utilities from the shared location
export {
  getWorkspaceRoot,
  requireWorkspaceFolders,
  getRelativePath,
  resolveWorkspacePath,
  isValidWorkspacePath,
  isWithinWorkspaceRoot,
  toToolResult,
  toToolError,
  formatFileSize
} from "../../utils/workspace";