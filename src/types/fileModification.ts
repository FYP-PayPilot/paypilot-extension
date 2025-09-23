/**
 * Interface for file modification data
 */
export interface FileModification {
  fileName: string;
  filePath: string;
  content: string;
  summary?: string;
}
