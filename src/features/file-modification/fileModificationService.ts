import * as vscode from "vscode";
import { FileModification } from "../../types/fileModification";
import { ContextFile } from "../../types/context";
import { DiffService } from "../diff/diffService";

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
    const modifications: FileModification[] = []; // parsed results we will return

    // Split response into sections by File: directives so each file block can be parsed independently.
    const fileDirectiveRegex = /File:\s*([^\n\r]+)/gi;
    const matches = [...response.matchAll(fileDirectiveRegex)];
    
    if (matches.length === 0) {
      // Fallback: attempt to grab a single fenced block and apply it to the active editor.
      const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/;
      const codeMatch = response.match(codeBlockRegex);
      if (codeMatch && codeMatch[1]) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          return [{
            fileName: activeEditor.document.fileName.split('/').pop() || "Unknown",
            filePath: activeEditor.document.uri.fsPath,
            content: codeMatch[1].trim(),
            summary: "Code modification",
          }];
        }
      }
      return [];
    }

    for (let i = 0; i < matches.length; i++) {
      // For each File: directive collect the portion until the next directive.
      const match = matches[i];
      const fileName = match[1].trim();
      const startIndex = match.index! + match[0].length;
      const endIndex = i < matches.length - 1 ? matches[i + 1].index! : response.length;
      const section = response.substring(startIndex, endIndex);

      // Extract summary if provided.
      const summaryMatch = section.match(/Summary:\s*([^\n\r]+)/i);
      const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

      // Extract the code block containing the new file contents.
      const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/;
      const codeMatch = section.match(codeBlockRegex);
      
      if (codeMatch && codeMatch[1]) {
        // Resolve file path from context files
        const resolvedPath = this.resolveFilePath(fileName, contextFiles);
        if (resolvedPath) {
          modifications.push({
            fileName,
            filePath: resolvedPath,
            content: codeMatch[1].trim(),
            summary
          });
        } else {
          console.warn(`[PayPilot] Could not resolve file path for: ${fileName}`);
        }
      }
    }

    return modifications;
  }

  /**
   * Resolve a file name emitted by the AI to an absolute path using the provided context files.
   * Used by parseMultipleFileModifications before scheduling an edit.
   * @param fileName Name reported by the model (e.g. `src/app.ts`).
   * @param contextFiles Files the user attached for this chat session.
   * @returns Absolute file path or null when no match is found.
   */
  resolveFilePath(fileName: string, contextFiles: ContextFile[]): string | null {
    if (!Array.isArray(contextFiles)) {
      return null;
    }
    
    // First try exact file name match.
    let matchedFile = contextFiles.find((f) => f.fileName === fileName);
    
    // If no exact match, see if any path ends with the requested file name.
    if (!matchedFile) {
      matchedFile = contextFiles.find((f) =>
        typeof f.filePath === 'string' && 
        (f.filePath.endsWith('/' + fileName) || f.filePath.endsWith('\\' + fileName))
      );
    }
    
    // As a final fallback, accept any path that merely contains the string.
    if (!matchedFile) {
      matchedFile = contextFiles.find((f) =>
        typeof f.filePath === 'string' && f.filePath.includes(fileName)
      );
    }
    
    return matchedFile ? matchedFile.filePath : null;
  }

  /**
   * Sanity-check that the target file exists before attempting to overwrite it.
   * Used by MessageHandlerService to filter out unreachable edits.
   */
  validateFileModification(modification: FileModification): boolean {
    // Check if file exists
    try {
      const uri = vscode.Uri.file(modification.filePath);
      // This will throw if file doesn't exist
      vscode.workspace.fs.stat(uri);
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
    // Simple heuristic: prioritise config and TypeScript files before styles/docs.
    const priorityOrder = [
      '.json',    // Config files first
      '.ts',      // TypeScript files
      '.js',      // JavaScript files
      '.tsx',     // React TypeScript
      '.jsx',     // React JavaScript
      '.css',     // Styles
      '.md'       // Documentation last
    ];

    return modifications.sort((a, b) => {
      const aExt = this.getFileExtension(a.fileName);
      const bExt = this.getFileExtension(b.fileName);
      
      const aPriority = priorityOrder.indexOf(aExt);
      const bPriority = priorityOrder.indexOf(bExt);
      
      // If both have known extensions, sort by priority.
      if (aPriority !== -1 && bPriority !== -1) {
        return aPriority - bPriority;
      }
      
      // If only one has known extension, prioritise it.
      if (aPriority !== -1) {
        return -1;
      }
      if (bPriority !== -1) {
        return 1;
      }
      
      // If neither has a known extension, fall back to alphabetical order.
      return a.fileName.localeCompare(b.fileName);
    });
  }

  /**
   * Helper to extract a filename extension used by the dependency sorter.
   * @param fileName Name of the file (e.g. `app.ts`).
   * @returns Extension including the dot (e.g. `.ts`) or empty string if none.
   */
  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot !== -1 ? fileName.substring(lastDot) : '';
  }


  /**
   * Apply a batch of modifications, handling backups and diff tracking.
   * @param modifications Parsed modifications to apply.
   * @param diffService DiffService used to update tracked files.
   * @param panel Webview panel to report progress/errors to.
   */
  async applyModifications(
    modifications: FileModification[],
    diffService: DiffService,
    panel: vscode.Webview
  ): Promise<void> {
    const sortedModifications = this.sortModificationsByDependency(modifications);
    const backups = await this.createBackups(sortedModifications);
    const diffEntries: Array<{ filePath: string; originalContent: string }> = [];

    for (const modification of sortedModifications) {
      try {
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

        diffEntries.push({ filePath: modification.filePath, originalContent });

        panel.postMessage({
          type: "chat:code-applied",
          fileName: modification.fileName,
          filePath: modification.filePath,
          linesAdded: diffStats.added,
          linesDeleted: diffStats.deleted,
          explanation: modification.summary || `Updated ${modification.fileName}`,
        });
      } catch (error) {
        console.error(`[PayPilot] Error applying ${modification.fileName}:`, error);
        if (backups.size > 0) {
          await this.restoreFromBackups(backups);
        }
        panel.postMessage({
          type: "chat:error",
          error: `Failed to modify ${modification.fileName}: ${error}`,
        });
        return;
      }
    }

    if (diffEntries.length > 0) {
      await diffService.trackModifiedFiles(diffEntries);
    }
  }

  /**
   * Create backup of files before modification
   * @param modifications Array of file modifications to back up
   * @returns Map of file paths to their original content
   */
  async createBackups(modifications: FileModification[]): Promise<Map<string, string>> {
    const backups = new Map<string, string>();
    
    for (const modification of modifications) {
      try {
        const uri = vscode.Uri.file(modification.filePath);
        const content = await vscode.workspace.fs.readFile(uri);
        const contentStr = Buffer.from(content).toString('utf8');
        backups.set(modification.filePath, contentStr);
      } catch (error) {
        console.error(`[PayPilot] Failed to create backup for ${modification.filePath}:`, error);
      }
    }
    
    return backups;
  }

  /**
   * Restore files from backup
   * @param backups Map of file paths to their backed-up content
   * @returns Promise that resolves when all files have been restored
   */
  async restoreFromBackups(backups: Map<string, string>): Promise<void> {
    for (const [filePath, content] of backups.entries()) {
      try {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        
        // Replace the entire document body with the backed-up content.
        await editor.edit((editBuilder) => {
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
          );
          editBuilder.replace(fullRange, content);
        });
      } catch (error) {
        console.error(`[PayPilot] Failed to restore backup for ${filePath}:`, error);
      }
    }
  }

  /**
   * Apply file modification to a specific file
   */
  async applyFileModification(modification: FileModification): Promise<boolean> {
    try {
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
      
      console.log(`[PayPilot] Successfully applied changes to ${modification.fileName}`);
      return true;
    } catch (error) {
      console.error(`[PayPilot] Failed to apply changes to ${modification.fileName}:`, error);
      return false;
    }
  }
}
