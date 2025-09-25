import * as path from "path";
import * as vscode from "vscode";
import {
  CreateFileModification,
  DeleteFileModification,
  FileModification,
  FileOperation,
  UpdateFileModification,
} from "../../types/fileModification";
import { ContextFile } from "../../types/context";
import { DiffService } from "../diff/diffService";
import { ContextMessageService } from "../context/contextMessageService";

/**
 * Service class for handling file modification parsing and resolution
 */
export class FileModificationService {
  /**
   * Parse multiple file modifications emitted by the AI response.
   * Called from MessageHandlerService.handleAgentMode once the model has finished streaming.
   * Handles `File:` / `Summary:` / fenced ``` blocks and falls back to the active editor if none exist.
   * @param response Raw AI response text.
   * @param contextFiles Context files shared by the user so we can resolve absolute paths.
   * @returns Array of structured file modifications ready to apply.
   */
  parseMultipleFileModifications(response: string, contextFiles: ContextFile[]): FileModification[] {
    const modifications: FileModification[] = [];
    const fileDirectiveRegex = /File:\s*([^\n\r]+)/gi;
    const matches = [...response.matchAll(fileDirectiveRegex)];

    if (matches.length === 0) {
      const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/;
      const codeMatch = response.match(codeBlockRegex);
      if (codeMatch && codeMatch[1]) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          return [{
            operation: "update",
            fileName: activeEditor.document.fileName.split("/").pop() || "Unknown",
            filePath: activeEditor.document.uri.fsPath,
            content: codeMatch[1].trim(),
            summary: "Code modification",
          }];
        }
      }
      return [];
    }

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const fileLabel = match[1].trim();
      const startIndex = match.index! + match[0].length;
      const endIndex = i < matches.length - 1 ? matches[i + 1].index! : response.length;
      const section = response.substring(startIndex, endIndex);

      const operation = this.parseOperation(section);
      const summaryMatch = section.match(/Summary:\s*([^\n\r]+)/i);
      const summary = summaryMatch ? summaryMatch[1].trim() : undefined;
      const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/;
      const codeMatch = section.match(codeBlockRegex);
      const resolvedPath = this.resolveFilePath(fileLabel, contextFiles);

      if (!resolvedPath) {
        console.warn(`[PayPilot] Could not resolve file path for: ${fileLabel}`);
        continue;
      }

      if (operation === "delete") {
        modifications.push({
          operation,
          fileName: fileLabel,
          filePath: resolvedPath,
          summary,
        });
        continue;
      }

      if (!codeMatch || !codeMatch[1]) {
        console.warn(`[PayPilot] Missing code block for ${operation} on ${fileLabel}`);
        continue;
      }

      modifications.push({
        operation,
        fileName: fileLabel,
        filePath: resolvedPath,
        content: codeMatch[1].trim(),
        summary,
      });
    }

    return modifications;
  }

  /**
   * Resolve a file name emitted by the AI to an absolute path using the provided context files.
   * Falls back to workspace-relative resolution when the file is not part of the context list.
   */
  resolveFilePath(fileName: string, contextFiles: ContextFile[]): string | null {
    if (Array.isArray(contextFiles)) {
      let matchedFile = contextFiles.find((f) => f.fileName === fileName);

      if (!matchedFile) {
        matchedFile = contextFiles.find(
          (f) =>
            typeof f.filePath === "string" &&
            (f.filePath.endsWith('/' + fileName) || f.filePath.endsWith('\\' + fileName))
        );
      }

      if (!matchedFile) {
        matchedFile = contextFiles.find(
          (f) => typeof f.filePath === "string" && f.filePath.includes(fileName)
        );
      }

      if (matchedFile?.filePath && this.isPathInsideWorkspace(matchedFile.filePath)) {
        return matchedFile.filePath;
      }
    }

    return this.resolveWorkspacePath(fileName);
  }

  /**
   * Sanity-check that the target file exists (when required) and is inside the workspace.
   * Used by MessageHandlerService to filter out unreachable edits.
   */
  validateFileModification(modification: FileModification): boolean {
    if (!this.isPathInsideWorkspace(modification.filePath)) {
      console.warn(`[PayPilot] File is outside the workspace: ${modification.filePath}`);
      return false;
    }

    if (modification.operation === "create") {
      return true;
    }

    try {
      const uri = vscode.Uri.file(modification.filePath);
      void vscode.workspace.fs.stat(uri);
      return true;
    } catch (error) {
      console.warn(`[PayPilot] File does not exist: ${modification.filePath}`);
      return false;
    }
  }

  /**
   * Sort modifications heuristically so configuration files are applied before dependants.
   * Called from MessageHandlerService.processFileModifications prior to writing to disk.
   */
  sortModificationsByDependency(modifications: FileModification[]): FileModification[] {
    const priorityOrder = [
      ".json",
      ".ts",
      ".js",
      ".tsx",
      ".jsx",
      ".css",
      ".md",
    ];

    return modifications.sort((a, b) => {
      const aExt = this.getFileExtension(a.fileName);
      const bExt = this.getFileExtension(b.fileName);

      const aPriority = priorityOrder.indexOf(aExt);
      const bPriority = priorityOrder.indexOf(bExt);

      if (aPriority !== -1 && bPriority !== -1) {
        return aPriority - bPriority;
      }

      if (aPriority !== -1) {
        return -1;
      }
      if (bPriority !== -1) {
        return 1;
      }

      return a.fileName.localeCompare(b.fileName);
    });
  }

  /**
   * Helper to extract a filename extension used by the dependency sorter.
   */
  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".");
    return lastDot !== -1 ? fileName.substring(lastDot) : "";
  }

  /**
   * Apply a batch of modifications, handling backups, diff tracking, and error recovery.
   */
  async applyModifications(
    modifications: FileModification[],
    diffService: DiffService,
    panel: vscode.Webview,
    contextMessageService?: ContextMessageService
  ): Promise<void> {
    const sortedModifications = this.sortModificationsByDependency(modifications);
    const backupCandidates = sortedModifications.filter((mod) => mod.operation !== "create");
    const backups = await this.createBackups(backupCandidates);
    const createdFiles: string[] = [];
    const diffEntries: Array<{
      filePath: string;
      originalContent: string;
      operation: FileOperation;
    }> = [];

    for (const modification of sortedModifications) {
      let effectiveModification: FileModification = modification;
      try {
        if (modification.operation === "create") {
          const uri = vscode.Uri.file(modification.filePath);
          if (await this.fileExists(uri)) {
            console.warn(`[PayPilot] ${modification.fileName} already exists. Treating create as update.`);
            const existingContent =
              backups.get(modification.filePath) ?? (await this.readFileSafely(uri)) ?? "";
            backups.set(modification.filePath, existingContent);
            effectiveModification = {
              operation: "update",
              fileName: modification.fileName,
              filePath: modification.filePath,
              content: modification.content,
              summary: modification.summary,
            };
          }
        }

        let originalContent = '';
        let added = 0;
        let deleted = 0;

        switch (effectiveModification.operation) {
          case "create": {
            const result = await this.applyCreate(effectiveModification, diffService);
            added = result.added;
            deleted = result.deleted;
            createdFiles.push(effectiveModification.filePath);
            break;
          }
          case "update": {
            const result = await this.applyUpdate(effectiveModification, diffService);
            originalContent = result.originalContent;
            added = result.added;
            deleted = result.deleted;
            break;
          }
          case "delete": {
            const result = await this.applyDelete(effectiveModification, diffService);
            originalContent = result.originalContent;
            added = result.added;
            deleted = result.deleted;
            // Notify the context subsystem so deleted files vanish from the context list immediately.
            if (contextMessageService) {
              contextMessageService.handleExternalRemoval(effectiveModification.filePath, panel);
            }
            break;
          }
        }

        diffEntries.push({
          filePath: effectiveModification.filePath,
          originalContent,
          operation: effectiveModification.operation,
        });

        const displayName = path.basename(effectiveModification.filePath);

        panel.postMessage({
          type: "chat:code-applied",
          fileName: displayName,
          filePath: effectiveModification.filePath,
          linesAdded: added,
          linesDeleted: deleted,
          explanation:
            effectiveModification.summary ?? this.getDefaultSummary(effectiveModification),
          operation: effectiveModification.operation,
        });
      } catch (error) {
        console.error(`[PayPilot] Error applying ${effectiveModification.fileName}:`, error);
        if (backups.size > 0) {
          await this.restoreFromBackups(backups);
        }
        if (createdFiles.length > 0) {
          await Promise.all(createdFiles.map((file) => this.safeDeleteFile(file)));
        }
        panel.postMessage({
          type: "chat:error",
          error: `Failed to modify ${effectiveModification.fileName}: ${error}`,
        });
        return;
      }
    }

    if (diffEntries.length > 0) {
      await diffService.trackModifiedFiles(diffEntries);
    }
  }

  /**
   * Create backup of files before modification.
   */
  async createBackups(modifications: FileModification[]): Promise<Map<string, string>> {
    const backups = new Map<string, string>();

    for (const modification of modifications) {
      if (modification.operation === "create") {
        continue;
      }

      try {
        const uri = vscode.Uri.file(modification.filePath);
        const content = await vscode.workspace.fs.readFile(uri);
        backups.set(modification.filePath, Buffer.from(content).toString("utf8"));
      } catch (error) {
        console.error(`[PayPilot] Failed to create backup for ${modification.filePath}:`, error);
      }
    }

    return backups;
  }

  /**
   * Restore files from backup.
   */
  async restoreFromBackups(backups: Map<string, string>): Promise<void> {
    for (const [filePath, content] of backups.entries()) {
      try {
        const uri = vscode.Uri.file(filePath);
        await this.ensureParentDirectory(uri);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
      } catch (error) {
        console.error(`[PayPilot] Failed to restore backup for ${filePath}:`, error);
      }
    }
  }

  /**
   * Apply file modification to a specific file without diff tracking.
   */
  async applyFileModification(modification: FileModification, contextMessageService?: ContextMessageService, panel?: vscode.Webview): Promise<boolean> {
    try {
      switch (modification.operation) {
        case "create":
          await this.ensureParentDirectory(vscode.Uri.file(modification.filePath));
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(modification.filePath),
            Buffer.from(modification.content, "utf8")
          );
          break;
        case "update": {
          const uri = vscode.Uri.file(modification.filePath);
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document, { preview: false });

          await editor.edit((editBuilder) => {
            const fullRange = new vscode.Range(
              editor.document.positionAt(0),
              editor.document.positionAt(editor.document.getText().length)
            );
            editBuilder.replace(fullRange, modification.content);
          });
          break;
        }
        case "delete": {
          const uri = vscode.Uri.file(modification.filePath);
          await this.ensureParentDirectory(uri);
          await vscode.workspace.fs.writeFile(uri, Buffer.from("", "utf8"));
          break;
        }
      }

      console.log(`[PayPilot] Successfully applied ${modification.operation} on ${modification.fileName}`);
      return true;
    } catch (error) {
      console.error(`[PayPilot] Failed to apply ${modification.operation} on ${modification.fileName}:`, error);
      return false;
    }
  }

  private parseOperation(section: string): FileOperation {
    const match = section.match(/Operation:\s*([^\n\r]+)/i);
    const value = match ? match[1].trim().toLowerCase() : "";
    switch (value) {
      case "create":
      case "delete":
        return value;
      case "update":
      case "modify":
        return "update";
      default:
        return "update";
    }
  }

  private resolveWorkspacePath(fileName: string): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    const normalisedInput = fileName.replace(/[\\/]/g, path.sep);

    if (path.isAbsolute(normalisedInput)) {
      const resolved = path.normalize(normalisedInput);
      return this.isPathInsideWorkspace(resolved) ? resolved : null;
    }

    for (const folder of workspaceFolders) {
      const candidate = path.normalize(path.join(folder.uri.fsPath, normalisedInput));
      if (this.isPathInsideWorkspace(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private isPathInsideWorkspace(filePath: string): boolean {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return false;
    }

    const normalised = path.resolve(filePath);
    return workspaceFolders.some((folder) => {
      const folderPath = path.resolve(folder.uri.fsPath);
      return normalised === folderPath || normalised.startsWith(folderPath + path.sep);
    });
  }

  private getDefaultSummary(modification: FileModification): string {
    switch (modification.operation) {
      case "create":
        return `Created ${modification.fileName}`;
      case "delete":
        return `Deleted ${modification.fileName}`;
      default:
        return `Updated ${modification.fileName}`;
    }
  }

  private async applyCreate(
    modification: CreateFileModification,
    diffService: DiffService
  ): Promise<{ added: number; deleted: number }> {
    const uri = vscode.Uri.file(modification.filePath);
    await this.ensureParentDirectory(uri);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(modification.content, "utf8"));

    const newLines = modification.content.split("\n");
    const stats = diffService.calculateDiffStats([], newLines);
    return { added: stats.added, deleted: stats.deleted };
  }

  private async applyUpdate(
    modification: UpdateFileModification,
    diffService: DiffService
  ): Promise<{ originalContent: string; added: number; deleted: number }> {
    const uri = vscode.Uri.file(modification.filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const originalContent = document.getText();
    const originalLines = originalContent.split("\n");
    const newLines = modification.content.split("\n");
    const diffStats = diffService.calculateDiffStats(originalLines, newLines);

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(originalContent.length)
    );
    edit.replace(uri, fullRange, modification.content);

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error(`Unable to apply edits for ${modification.fileName}`);
    }
    await document.save();

    return {
      originalContent,
      added: diffStats.added,
      deleted: diffStats.deleted,
    };
  }

  private async applyDelete(
    modification: DeleteFileModification,
    diffService: DiffService
  ): Promise<{ originalContent: string; added: number; deleted: number }> {
    const uri = vscode.Uri.file(modification.filePath);
    const originalContent = await this.readFileSafely(uri);

    if (originalContent === null) {
      throw new Error(`Cannot delete missing file ${modification.fileName}`);
    }

    await this.ensureParentDirectory(uri);
    await vscode.workspace.fs.writeFile(uri, Buffer.from('', 'utf8'));

    const originalLines = originalContent.split('\n');
    const diffStats = diffService.calculateDiffStats(originalLines, []);
    return {
      originalContent,
      added: diffStats.added,
      deleted: diffStats.deleted,
    };
  }

  private async ensureParentDirectory(uri: vscode.Uri): Promise<void> {
    const dirPath = path.dirname(uri.fsPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
  }

  private async safeDeleteFile(filePath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath);
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return;
      }
      console.warn(`[PayPilot] Failed to clean up ${filePath}:`, error);
    }
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return false;
      }
      throw error;
    }
  }

  private async readFileSafely(uri: vscode.Uri): Promise<string | null> {
    try {
      const buffer = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(buffer).toString("utf8");
    } catch (error) {
      return null;
    }
  }
}
