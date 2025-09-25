/**
 * Interface for file modification data
 */
export type FileOperation =
  | "create"
  | "update"
  | "delete";

interface BaseFileModification {
  fileName: string;
  filePath: string;
  summary?: string;
}

export interface CreateFileModification extends BaseFileModification {
  operation: "create";
  content: string;
}

export interface UpdateFileModification extends BaseFileModification {
  operation: "update";
  content: string;
}

export interface DeleteFileModification extends BaseFileModification {
  operation: "delete";
}

export type FileModification =
  | CreateFileModification
  | UpdateFileModification
  | DeleteFileModification;
