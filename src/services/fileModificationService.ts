import * as vscode from "vscode";

/**
 * Interface for file modification data
 */
export interface FileModification {
  fileName: string;
  filePath: string;
  content: string;
  summary?: string;
}

/**
 * Service class for handling file modification parsing and resolution
 */
export class FileModificationService {
  /**
   * Parse multiple file modifications from AI response
   * Handles cases where AI provides multiple File:/Summary:/Code blocks
   */
  parseMultipleFileModifications(response: string, contextFiles: any[]): FileModification[] {
    const modifications: FileModification[] = [];

    // Split response into sections by File: directives
    const fileDirectiveRegex = /File:\s*([^\n\r]+)/gi;
    const matches = [...response.matchAll(fileDirectiveRegex)];
    
    if (matches.length === 0) {
      // Fallback: try single code block without file directive
      const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/;
      const codeMatch = response.match(codeBlockRegex);
      if (codeMatch && codeMatch[1]) {
        // Use current active editor if available
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          return [{
            fileName: activeEditor.document.fileName.split('/').pop() || 'Unknown',
            filePath: activeEditor.document.uri.fsPath,
            content: codeMatch[1].trim(),
            summary: 'Code modification'
          }];
        }
      }
      return [];
    }

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const fileName = match[1].trim();
      const startIndex = match.index! + match[0].length;
      const endIndex = i < matches.length - 1 ? matches[i + 1].index! : response.length;
      const section = response.substring(startIndex, endIndex);

      // Extract summary
      const summaryMatch = section.match(/Summary:\s*([^\n\r]+)/i);
      const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

      // Extract code block
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
   * Resolve file name to absolute path using context files
   */
  resolveFilePath(fileName: string, contextFiles: any[]): string | null {
    if (!Array.isArray(contextFiles)) {
      return null;
    }
    
    // First try exact fileName match
    let matchedFile = contextFiles.find((f: any) => f.fileName === fileName);
    
    // If no exact match, try path ending match
    if (!matchedFile) {
      matchedFile = contextFiles.find((f: any) =>
        typeof f.filePath === 'string' && 
        (f.filePath.endsWith('/' + fileName) || f.filePath.endsWith('\\' + fileName))
      );
    }
    
    // If still no match, try any path that contains the target
    if (!matchedFile) {
      matchedFile = contextFiles.find((f: any) =>
        typeof f.filePath === 'string' && f.filePath.includes(fileName)
      );
    }
    
    return matchedFile ? matchedFile.filePath : null;
  }

  /**
   * Validate file modification before applying
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
   * Get file modification statistics
   */
  getModificationStats(modifications: FileModification[]): {
    totalFiles: number;
    validFiles: number;
    invalidFiles: number;
    fileNames: string[];
  } {
    const validFiles = modifications.filter(mod => this.validateFileModification(mod));
    
    return {
      totalFiles: modifications.length,
      validFiles: validFiles.length,
      invalidFiles: modifications.length - validFiles.length,
      fileNames: modifications.map(mod => mod.fileName)
    };
  }

  /**
   * Sort file modifications by dependency order
   * Files with fewer dependencies should be modified first
   */
  sortModificationsByDependency(modifications: FileModification[]): FileModification[] {
    // Simple heuristic: sort by file type and common dependency patterns
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
      
      // If both have known extensions, sort by priority
      if (aPriority !== -1 && bPriority !== -1) {
        return aPriority - bPriority;
      }
      
      // If only one has known extension, prioritize it
      if (aPriority !== -1) {
        return -1;
      }
      if (bPriority !== -1) {
        return 1;
      }
      
      // If neither has known extension, sort alphabetically
      return a.fileName.localeCompare(b.fileName);
    });
  }

  /**
   * Get file extension from filename
   */
  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot !== -1 ? fileName.substring(lastDot) : '';
  }

  /**
   * Create backup of files before modification
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
   */
  async restoreFromBackups(backups: Map<string, string>): Promise<void> {
    for (const [filePath, content] of backups.entries()) {
      try {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        
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