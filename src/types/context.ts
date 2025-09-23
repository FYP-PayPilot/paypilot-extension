/**
 * Interface for context file data
 */
export interface ContextFile {
  filePath: string;
  fileName: string;
  content: string;
  size: number;
}

/**
 * Interface for file picker options
 */
export interface FilePickerOptions {
  canSelectFiles: boolean;
  canSelectFolders: boolean;
  canSelectMany: boolean;
  openLabel: string;
  filters?: Record<string, string[]>;
}