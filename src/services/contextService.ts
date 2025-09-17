import * as vscode from "vscode";

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

/**
 * Service class for handling context file operations
 */
export class ContextService {
  private contextFiles: Map<string, ContextFile> = new Map();

  /**
   * Handle context file request - show VS Code workspace file picker
   */
  async requestContextFiles(): Promise<ContextFile[]> {
    try {
      // Get all files in the workspace
      const workspaceFiles = await vscode.workspace.findFiles(
        "**/*", // Include all files
        "**/node_modules/**" // Exclude node_modules
      );

      if (workspaceFiles.length === 0) {
        vscode.window.showInformationMessage("No files found in workspace");
        return [];
      }

      // Create quick pick items from workspace files
      const quickPickItems = workspaceFiles.map((file) => {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
        const relativePath = workspaceFolder
          ? vscode.workspace.asRelativePath(file, false)
          : file.fsPath;

        return {
          label: file.path.split("/").pop() || file.fsPath,
          description: relativePath,
          detail: file.fsPath,
          uri: file,
        };
      });

      // Add option to browse external files
      quickPickItems.unshift({
        label: "📁 Browse files outside workspace...",
        description: "Select files from anywhere on your system",
        detail: "Open file browser",
        uri: null as any, // Special marker for browse option
      });

      // Sort workspace files by file name for better UX (keeping browse option at top)
      const browseOption = quickPickItems.shift();
      quickPickItems.sort((a, b) => a.label.localeCompare(b.label));
      quickPickItems.unshift(browseOption!);

      // Show quick pick for file selection
      const selectedItems = await vscode.window.showQuickPick(
        quickPickItems,
        {
          canPickMany: true,
          placeHolder: "Select files to add to context",
          matchOnDescription: true,
          matchOnDetail: true,
        }
      );

      if (selectedItems && selectedItems.length > 0) {
        // Check if user selected the browse option
        const browseOptionSelected = selectedItems.some((item) => !item.uri);
        const workspaceFilesSelected = selectedItems.filter(
          (item) => item.uri
        );

        let contextFiles: ContextFile[] = [];

        // Process workspace files
        if (workspaceFilesSelected.length > 0) {
          const workspaceContextFiles = await this.processWorkspaceFiles(workspaceFilesSelected);
          contextFiles.push(...workspaceContextFiles);
        }

        // Handle external file browsing
        if (browseOptionSelected) {
          const externalContextFiles = await this.browseExternalFiles();
          contextFiles.push(...externalContextFiles);
        }

        // Add to context files map
        contextFiles.forEach(file => {
          this.contextFiles.set(file.filePath, file);
        });

        return contextFiles;
      }

      return [];
    } catch (error) {
      console.error("Error in requestContextFiles:", error);
      throw new Error(`Failed to request context files: ${error}`);
    }
  }

  /**
   * Process workspace files and convert to ContextFile objects
   */
  private async processWorkspaceFiles(selectedItems: any[]): Promise<ContextFile[]> {
    return Promise.all(
      selectedItems.map(async (item) => {
        try {
          const content = await vscode.workspace.fs.readFile(item.uri!);
          const contentStr = Buffer.from(content).toString("utf8");
          const stats = await vscode.workspace.fs.stat(item.uri!);

          return {
            filePath: item.uri!.fsPath,
            fileName: item.label,
            content: contentStr,
            size: stats.size,
          };
        } catch (error) {
          console.error(`Error reading file ${item.uri!.fsPath}:`, error);
          return {
            filePath: item.uri!.fsPath,
            fileName: item.label,
            content: `Error reading file: ${error}`,
            size: 0,
          };
        }
      })
    );
  }

  /**
   * Browse external files outside workspace
   */
  private async browseExternalFiles(): Promise<ContextFile[]> {
    const externalFiles = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "Add to Context",
      filters: {
        "All Files": ["*"],
        "Source Code": [
          "js", "ts", "jsx", "tsx", "py", "java", "cpp", "c", "h", "cs", 
          "php", "rb", "go", "rs", "swift", "kt",
        ],
        "Text Files": [
          "txt", "md", "json", "xml", "yaml", "yml", "csv",
        ],
      },
    });

    if (externalFiles && externalFiles.length > 0) {
      return Promise.all(
        externalFiles.map(async (file) => {
          try {
            const content = await vscode.workspace.fs.readFile(file);
            const contentStr = Buffer.from(content).toString("utf8");
            const stats = await vscode.workspace.fs.stat(file);

            return {
              filePath: file.fsPath,
              fileName: file.path.split("/").pop() || file.fsPath,
              content: contentStr,
              size: stats.size,
            };
          } catch (error) {
            console.error(`Error reading file ${file.fsPath}:`, error);
            return {
              filePath: file.fsPath,
              fileName: file.path.split("/").pop() || file.fsPath,
              content: `Error reading file: ${error}`,
              size: 0,
            };
          }
        })
      );
    }

    return [];
  }

  /**
   * Add specific files to context by file paths
   */
  async addFilesToContext(filePaths: string[]): Promise<ContextFile[]> {
    const addedFiles: ContextFile[] = [];

    for (const filePath of filePaths) {
      try {
        const uri = vscode.Uri.file(filePath);
        const content = await vscode.workspace.fs.readFile(uri);
        const contentStr = Buffer.from(content).toString("utf8");
        const stats = await vscode.workspace.fs.stat(uri);

        const contextFile: ContextFile = {
          filePath,
          fileName: filePath.split('/').pop() || filePath,
          content: contentStr,
          size: stats.size,
        };

        this.contextFiles.set(filePath, contextFile);
        addedFiles.push(contextFile);
        
        console.log(`[PayPilot] Added ${contextFile.fileName} to context`);
      } catch (error) {
        console.error(`[PayPilot] Failed to add ${filePath} to context:`, error);
      }
    }

    return addedFiles;
  }

  /**
   * Remove a file from context
   */
  removeFileFromContext(filePath: string): boolean {
    const removed = this.contextFiles.delete(filePath);
    if (removed) {
      console.log(`[PayPilot] Removed file from context: ${filePath}`);
    }
    return removed;
  }

  /**
   * Clear all context files
   */
  clearAllContext(): void {
    this.contextFiles.clear();
    console.log("[PayPilot] Cleared all context files");
  }

  /**
   * Get all context files
   */
  getAllContextFiles(): ContextFile[] {
    return Array.from(this.contextFiles.values());
  }

  /**
   * Get context file by path
   */
  getContextFile(filePath: string): ContextFile | undefined {
    return this.contextFiles.get(filePath);
  }

  /**
   * Check if file is in context
   */
  hasContextFile(filePath: string): boolean {
    return this.contextFiles.has(filePath);
  }

  /**
   * Get context files summary
   */
  getContextSummary(): {
    totalFiles: number;
    totalSize: number;
    fileNames: string[];
    averageSize: number;
  } {
    const files = this.getAllContextFiles();
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    return {
      totalFiles: files.length,
      totalSize,
      fileNames: files.map(f => f.fileName),
      averageSize: files.length > 0 ? totalSize / files.length : 0
    };
  }

  /**
   * Build context content string for AI prompt
   */
  buildContextContent(): string {
    const files = this.getAllContextFiles();
    
    if (files.length === 0) {
      return "";
    }

    const contextSections = files.map((file) => {
      return [
        `--- ${file.fileName} ---`,
        `Path: ${file.filePath}`,
        file.content || "// File content not available",
        `--- End of ${file.fileName} ---`,
        "",
      ].join("\n");
    });

    return [
      "--- Additional Context Files ---",
      ...contextSections,
      "--- End of Additional Context Files ---",
      "",
    ].join("\n");
  }

  /**
   * Filter context files by extension
   */
  filterByExtension(extension: string): ContextFile[] {
    return this.getAllContextFiles().filter(file => 
      file.fileName.toLowerCase().endsWith(extension.toLowerCase())
    );
  }

  /**
   * Filter context files by size
   */
  filterBySize(minSize: number = 0, maxSize: number = Number.MAX_SAFE_INTEGER): ContextFile[] {
    return this.getAllContextFiles().filter(file => 
      file.size >= minSize && file.size <= maxSize
    );
  }

  /**
   * Search context files by content
   */
  searchByContent(searchTerm: string, caseSensitive: boolean = false): ContextFile[] {
    const term = caseSensitive ? searchTerm : searchTerm.toLowerCase();
    
    return this.getAllContextFiles().filter(file => {
      const content = caseSensitive ? file.content : file.content.toLowerCase();
      return content.includes(term);
    });
  }

  /**
   * Validate context file
   */
  validateContextFile(file: ContextFile): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!file.filePath || file.filePath.trim() === '') {
      errors.push('File path is required');
    }

    if (!file.fileName || file.fileName.trim() === '') {
      errors.push('File name is required');
    }

    if (file.content === undefined || file.content === null) {
      errors.push('File content is required');
    }

    if (file.size < 0) {
      errors.push('File size cannot be negative');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get context service statistics
   */
  getStats(): {
    totalFiles: number;
    totalSizeBytes: number;
    totalSizeMB: number;
    largestFile: string | null;
    smallestFile: string | null;
    extensions: Record<string, number>;
  } {
    const files = this.getAllContextFiles();
    const totalSizeBytes = files.reduce((sum, file) => sum + file.size, 0);
    
    let largestFile: ContextFile | undefined;
    let smallestFile: ContextFile | undefined;
    const extensions: Record<string, number> = {};

    files.forEach(file => {
      // Track largest/smallest files
      if (!largestFile || file.size > largestFile.size) {
        largestFile = file;
      }
      if (!smallestFile || file.size < smallestFile.size) {
        smallestFile = file;
      }

      // Count extensions
      const ext = file.fileName.split('.').pop()?.toLowerCase() || 'no-extension';
      extensions[ext] = (extensions[ext] || 0) + 1;
    });

    return {
      totalFiles: files.length,
      totalSizeBytes,
      totalSizeMB: Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100,
      largestFile: largestFile ? largestFile.fileName : null,
      smallestFile: smallestFile ? smallestFile.fileName : null,
      extensions
    };
  }

  /**
   * Export context files list
   */
  exportContextList(): {
    exportedAt: string;
    files: Array<{
      fileName: string;
      filePath: string;
      size: number;
    }>;
  } {
    return {
      exportedAt: new Date().toISOString(),
      files: this.getAllContextFiles().map(file => ({
        fileName: file.fileName,
        filePath: file.filePath,
        size: file.size
      }))
    };
  }

  /**
   * Import context files from exported list
   */
  async importContextList(exportData: any): Promise<number> {
    if (!exportData.files || !Array.isArray(exportData.files)) {
      throw new Error('Invalid export data format');
    }

    const filePaths = exportData.files.map((f: any) => f.filePath);
    const addedFiles = await this.addFilesToContext(filePaths);
    
    console.log(`[PayPilot] Imported ${addedFiles.length} context files`);
    return addedFiles.length;
  }
}