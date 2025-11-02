import * as vscode from "vscode";
import { ContextFile } from "./types";

/**
 * Service to manage context files for AI interactions
 * Allows adding/removing files, browsing workspace and external files
 */
export class ContextService {

  private contextFiles: Map<string, ContextFile> = new Map(); // key: filePath, value: ContextFile

  /**
   * Prompt the user to pick workspace or external files to seed the AI context.
   * Called from MessageHandlerService.handleContextRequest when the chat UI asks for more files.
   * @returns Promise resolving to the ContextFile entries that were added to the session.
   */
  async requestContextFiles(): Promise<ContextFile[]> {
    try {
      // Discover workspace files up front so the quick pick can list them.
      const workspaceFiles = await vscode.workspace.findFiles(
        "**/*", // Include all files
        "**/node_modules/**" // Exclude node_modules
      ); 

      // Abort early if there is nothing to offer.
      if (workspaceFiles.length === 0) {
        vscode.window.showInformationMessage("No files found in workspace");
        return [];
      }

      // Shape each URI into a QuickPick item so the user can recognise and select it.
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

      // Prepend an entry that lets the user browse outside the workspace if needed.
      quickPickItems.unshift({
        label: "📁 Browse files outside workspace...",
        description: "Select files from anywhere on your system",
        detail: "Open file browser",
        uri: null as any, // Special marker for browse option
      });

      // Sort the workspace entries alphabetically while keeping the browse option at the top.
      const browseOption = quickPickItems.shift();
      quickPickItems.sort((a, b) => a.label.localeCompare(b.label));
      quickPickItems.unshift(browseOption!);

      // Show the picker and wait for the user to confirm their choices.
      const selectedItems = await vscode.window.showQuickPick(
        quickPickItems,
        {
          canPickMany: true,
          placeHolder: "Select files to add to context",
          matchOnDescription: true,
          matchOnDetail: true,
        }
      );

      // Handle both workspace and external selections if the user picked anything.
      if (selectedItems && selectedItems.length > 0) {
        // Check whether the special browse option was picked so we can open the file dialog.
        const browseOptionSelected = selectedItems.some((item) => !item.uri);
        const workspaceFilesSelected = selectedItems.filter(
          (item) => item.uri
        );

        let contextFiles: ContextFile[] = []; // array to hold all context files

        // Load the selected workspace files from disk.
        if (workspaceFilesSelected.length > 0) {
          const workspaceContextFiles = await this.processWorkspaceFiles(workspaceFilesSelected);
          contextFiles.push(...workspaceContextFiles);
        }

        // Allow the user to add files from outside the workspace if requested.
        if (browseOptionSelected) {
          const externalContextFiles = await this.browseExternalFiles();
          contextFiles.push(...externalContextFiles);
        }

        // Persist every captured file into the in-memory context map.
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
   * Load metadata and content for workspace files chosen in the quick pick.
   * Called internally by requestContextFiles once the user confirms their selection.
   * @param selectedItems Quick pick entries containing workspace file URIs.
   * @returns Promise resolving to ContextFile representations of the selections.
   */
  private async processWorkspaceFiles(selectedItems: any[]): Promise<ContextFile[]> {
    return Promise.all(
      selectedItems.map(async (item) => {
        try {
          // Read the on-disk file and capture its text content.
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
   * Show an open dialog so the user can add files from outside the workspace.
   * Called from requestContextFiles when the browse option is selected in the picker.
   * @returns Promise resolving to ContextFile entries for any external files chosen.
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
            // Read each external file just like a workspace file.
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
   * Add specific files to the context when the caller already knows their paths.
   * Called from MessageHandlerService (e.g. handleContextAdd) and during context imports.
   * @param filePaths Absolute file system paths to add.
   * @returns Promise resolving to the ContextFile objects successfully added.
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
   * Remove a context file by path.
   * Called from MessageHandlerService.handleContextRemove when the user deletes an entry.
   * @param filePath Absolute path to drop from the context map.
   * @returns boolean indicating whether an entry was removed.
   */
  removeFileFromContext(filePath: string): boolean {
    const removed = this.contextFiles.delete(filePath);
    if (removed) {
      console.log(`[PayPilot] Removed file from context: ${filePath}`);
    }
    return removed;
  }

  /**
   * Drop every tracked context file and reset the map.
   * Called from MessageHandlerService (e.g. handleContextClear and dispose) during cleanup.
   * @returns void
   */
  clearAllContext(): void {
    this.contextFiles.clear();
    console.log("[PayPilot] Cleared all context files");
  }

  /**
   * Expose the current context files to callers that need richer metadata.
   */
  getContextFiles(): ContextFile[] {
    return Array.from(this.contextFiles.values());
  }

  /**
   * Compose the currently tracked context files into a prompt-friendly string.
   * Called from MessageHandlerService.handleChatQuery right before invoking the language model.
   * @returns String containing annotated file sections, or an empty string when no context exists.
   */

  /**
   * Capture the active editor content or focused selection to feed into chat prompts.
   * Applies the same trimming logic that MessageHandlerService previously embedded.
   */
  getActiveEditorContext(maxContextChars: number): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor || maxContextChars <= 0) {
      return '';
    }

    const documentText = editor.document.getText();
    if (documentText.length <= maxContextChars) {
      return documentText;
    }

    const selection = editor.selection;
    if (!selection.isEmpty) {
      return editor.document.getText(selection);
    }

    const cursorPosition = selection.active;
    const lineNumber = cursorPosition.line;
    const totalLines = editor.document.lineCount;

    const contextRadius = Math.floor(maxContextChars / 80);
    const startLine = Math.max(0, lineNumber - contextRadius);
    const endLine = Math.min(totalLines - 1, lineNumber + contextRadius);

    const contextRange = new vscode.Range(
      startLine, 0, endLine, editor.document.lineAt(endLine).text.length
    );
    return editor.document.getText(contextRange);
  }
  buildContextContent(): string {
    const files = Array.from(this.contextFiles.values());

    if (files.length === 0) {
      return "";
    }

    // Format each file as a labelled section so the LLM can see filenames and content.
    const contextSections = files.map((file) => [
      `--- ${file.fileName} ---`,
      `Path: ${file.filePath}`,
      file.content || "// File content not available",
      `--- End of ${file.fileName} ---`,
      "",
    ].join("\n"));

    return [
      "--- Additional Context Files ---",
      ...contextSections,
      "--- End of Additional Context Files ---",
      "",
    ].join("\n");
  }

}
