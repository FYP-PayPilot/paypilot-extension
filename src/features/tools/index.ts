/**
 * This index file provides the public interface for the PayPilot tools feature
 * 
 * Public exports:
 * - ToolsService: Main service class for tool management
 * - Tool types: Type definitions for tool inputs and configuration
 * - Utility functions: Shared utilities for workspace operations
 * 
 * Private components (not exported):
 * - Individual tool registration functions
 * - Internal utilities and helpers
 * - Tool implementation details
 */

// Main service export
export { ToolsService } from "./toolsService";

// Type definitions export
export type { 
  PaypilotToolset,
  WorkspaceContextInput,
  FileOperationInput,
  ReadFileInput,
  UpdateFileInput,
  DeleteFileInput,
  CreateDirectoryInput,
  DeleteDirectoryInput
} from "./types";

// Utility functions for advanced usage
export { 
  getWorkspaceRoot, 
  getRelativePath, 
  resolveWorkspacePath,
  isValidWorkspacePath,
  formatFileSize 
} from "../../utils/workspace";