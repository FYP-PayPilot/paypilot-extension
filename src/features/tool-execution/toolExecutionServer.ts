import * as vscode from "vscode";
import * as http from "http";
import * as path from "path";
import { resolveWorkspaceUri } from "../../utils/workspace";
import { DiffService } from "../diff/diffService";
import { FileOperation } from "../../types/diff";
import { relativeUriPath } from "../../utils/workspace";

/**
 * Integrated ToolExecutionServer that uses the same notification and tracking
 * infrastructure as the native agent mode (messageHandlerService).
 * 
 * This ensures consistent UX whether tools are called from:
 * - Native VS Code agent mode
 * - Backend agent mode via HTTP
 */
export class ToolExecutionServer {
  private server: http.Server | undefined;
  private port: number = 3001;
  
  constructor(
    private readonly diffService: DiffService,
    private readonly webviewPanel?: vscode.Webview
  ) {}

  private setupServer(): http.Server {
    return http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Handle preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Health check
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        }));
        return;
      }

      // Tool execution endpoint
      if (req.method === 'POST' && req.url === '/execute-tool') {
        let body = '';
        
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            const { toolName, toolArgs } = JSON.parse(body);
            console.log(`[ToolServer] Executing: ${toolName}`, toolArgs);

            // Execute tool using the integrated approach
            const result = await this.executeToolIntegrated(toolName, toolArgs);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (error) {
            console.error(`[ToolServer] Error:`, error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error)
            }));
          }
        });
        return;
      }

      // 404 for unknown routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  }

  /**
   * Execute tool using the same infrastructure as messageHandlerService.
   * This mirrors the flow: prepareToolContext → invokeTool → notifyToolActivity → applyToolSideEffects
   */
  private async executeToolIntegrated(toolName: string, toolArgs: any): Promise<any> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceRoot) {
      return {
        success: false,
        error: "No workspace folder open"
      };
    }

    try {
      // Step 1: Prepare tool context (capture before state)
      const context = await this.prepareToolContext(toolName, toolArgs);

      // Step 2: Notify tool activity (like notifyToolActivity in messageHandlerService)
      this.notifyToolActivity(toolName, toolArgs, context);

      // Step 3: Execute the tool
      const executionResult = await this.executeToolLocally(toolName, toolArgs);

      // Step 4: Apply side effects (track diffs, send notifications)
      if (context) {
        await this.applyToolSideEffects(context, toolName, executionResult);
      }

      // Step 5: Return result to backend
      return {
        success: true,
        result: executionResult
      };

    } catch (error) {
      // Send error notification to UI
      if (this.webviewPanel) {
        this.webviewPanel.postMessage({
          type: "chat:error",
          error: error instanceof Error ? error.message : String(error)
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Prepare tool context - captures file state BEFORE execution.
   * Mirrors prepareToolContext from messageHandlerService.
   */
  private async prepareToolContext(
    toolName: string,
    toolArgs: any
  ): Promise<
    | {
        uri: vscode.Uri;
        operation: FileOperation;
        originalContent: string;
        isDirectory?: boolean;
        directorySnapshot?: string;
      }
    | undefined
  > {
    // Context-only tools don't need tracking
    if (toolName === 'paypilot-workspaceContext' || !toolArgs.path) {
      return undefined;
    }

    const uri = resolveWorkspaceUri(toolArgs.path);

    switch (toolName) {
      case 'paypilot-createFile': {
        const { content, exists } = await this.readFileSnapshot(uri);
        return {
          uri,
          operation: exists ? "update" : "create",
          originalContent: content,
        };
      }

      case 'paypilot-updateFile': {
        const { content } = await this.readFileSnapshot(uri);
        return {
          uri,
          operation: "update",
          originalContent: content,
        };
      }

      case 'paypilot-deleteFile': {
        const { content, exists } = await this.readFileSnapshot(uri);
        if (!exists) {
          return undefined;
        }
        return {
          uri,
          operation: "delete",
          originalContent: content,
        };
      }

      case 'paypilot-createDirectory': {
        const snapshot = await this.captureDirectorySnapshot(uri);
        const exists = snapshot !== undefined;
        return {
          uri,
          operation: exists ? "update" : "create",
          originalContent: exists ? snapshot ?? "" : "",
          isDirectory: true,
          directorySnapshot: snapshot,
        };
      }

      case 'paypilot-deleteDirectory': {
        const snapshot = await this.captureDirectorySnapshot(uri);
        if (!snapshot) {
          return undefined;
        }
        return {
          uri,
          operation: "delete",
          originalContent: "",
          isDirectory: true,
          directorySnapshot: snapshot,
        };
      }

      default:
        return undefined;
    }
  }

  /**
   * Notify tool activity - sends real-time UI updates.
   * Mirrors notifyToolActivity from messageHandlerService.
   */
  private notifyToolActivity(
    toolName: string,
    toolArgs: any,
    context?: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
    }
  ): void {
    if (!this.webviewPanel) {
      return; // No UI to notify
    }

    const activity = this.describeToolActivity(toolName, toolArgs, context);
    if (!activity) {
      return;
    }

    // Send activity notification to webview
    this.webviewPanel.postMessage({
      type: "chat:tool-activity",
      ...activity,
    });

    console.log(`[ToolServer] Activity: ${activity.title}`);
  }

  /**
   * Describe tool activity for UI notifications.
   * Mirrors describeToolActivity from messageHandlerService.
   */
  private describeToolActivity(
    toolName: string,
    toolArgs: any,
    context?: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
    }
  ): { title: string; detail?: string; filePath?: string; operation?: string } | undefined {
    try {
      if (toolName === 'paypilot-workspaceContext') {
        return { title: "Gathering workspace context…", operation: "context" };
      }

      const candidatePath = toolArgs?.path;
      const targetUri = context?.uri ?? (candidatePath ? resolveWorkspaceUri(candidatePath) : undefined);

      if (!targetUri) {
        if (toolName === 'paypilot-readFile') {
          return { title: "Reading workspace data", operation: "read" };
        }
        return undefined;
      }

      const relativePath = relativeUriPath(targetUri);
      const fileName = path.basename(targetUri.fsPath);

      switch (toolName) {
        case 'paypilot-createFile': {
          const verb = context?.operation === "create" ? "created" : "updated";
          return {
            title: `${fileName} ${verb}`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: context?.operation ?? "create",
          };
        }
        case 'paypilot-updateFile': {
          return {
            title: `${fileName} updated`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "update",
          };
        }
        case 'paypilot-deleteFile': {
          return {
            title: `${fileName} deleted`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "delete",
          };
        }
        case 'paypilot-createDirectory': {
          return {
            title: `${fileName || relativePath} directory created`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "directory",
          };
        }
        case 'paypilot-deleteDirectory': {
          return {
            title: `${fileName || relativePath} directory deleted`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "directory-delete",
          };
        }
        case 'paypilot-readFile': {
          return {
            title: `${fileName} read`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "read",
          };
        }
        default:
          return {
            title: `Invoked ${toolName}`,
            detail: relativePath,
            filePath: targetUri.fsPath,
          };
      }
    } catch (error) {
      console.warn("[ToolServer] Failed to describe tool activity", error);
      return undefined;
    }
  }

  /**
   * Apply tool side effects - track changes, calculate diffs, send notifications.
   * Mirrors applyToolSideEffects from messageHandlerService.
   */
  private async applyToolSideEffects(
    context: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
      isDirectory?: boolean;
      directorySnapshot?: string;
    },
    toolName: string,
    executionResult: any
  ): Promise<void> {
    if (!this.webviewPanel) {
      return; // No UI to notify
    }

    // Handle directory operations
    if (context.isDirectory) {
      await this.diffService.trackModifiedFiles([
        {
          filePath: context.uri.fsPath,
          originalContent: context.originalContent,
          operation: context.operation,
          isDirectory: true,
          directorySnapshot: context.directorySnapshot,
        },
      ]);

      this.webviewPanel.postMessage({
        type: "chat:code-applied",
        fileName: path.basename(context.uri.fsPath),
        filePath: context.uri.fsPath,
        linesAdded: 0,
        linesDeleted: 0,
        explanation: this.describeOperation(context.operation, context.uri.fsPath),
        operation: context.operation,
      });

      return;
    }

    // Read file content after execution
    let nextContent = "";
    if (context.operation !== "delete") {
      try {
        nextContent = await this.readFileAfterTool(context.uri);
      } catch (error) {
        console.warn(
          `[ToolServer] Failed to read modified file ${context.uri.fsPath}:`,
          error
        );
      }
    }

    // Calculate diff statistics
    const diffStats = this.diffService.calculateDiffStats(
      context.originalContent.split("\n"),
      context.operation === "delete" ? [] : nextContent.split("\n")
    );

    // Track modified files in diff service (enables accept/reject workflow)
    await this.diffService.trackModifiedFiles([
      {
        filePath: context.uri.fsPath,
        originalContent: context.originalContent,
        operation: context.operation,
      },
    ]);

    // Send code-applied notification with diff stats
    this.webviewPanel.postMessage({
      type: "chat:code-applied",
      fileName: path.basename(context.uri.fsPath),
      filePath: context.uri.fsPath,
      linesAdded: diffStats.added,
      linesDeleted: diffStats.deleted,
      explanation: this.describeOperation(context.operation, context.uri.fsPath),
      operation: context.operation,
    });

    console.log(
      `[ToolServer] Tracked changes: +${diffStats.added} -${diffStats.deleted} lines`
    );
  }

  private describeOperation(operation: FileOperation, filePath: string): string {
    const fileName = path.basename(filePath);
    switch (operation) {
      case "create":
        return `Created ${fileName}`;
      case "delete":
        return `Deleted ${fileName}`;
      default:
        return `Updated ${fileName}`;
    }
  }

  /**
   * Execute the actual tool operation (file system operations)
   */
  private async executeToolLocally(toolName: string, toolArgs: any): Promise<any> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceRoot) {
      throw new Error("No workspace folder open");
    }

    switch (toolName) {
      case 'paypilot-workspaceContext':
        return await this.getWorkspaceContext(toolArgs);
      
      case 'paypilot-readFile':
        return await this.readFile(toolArgs);
      
      case 'paypilot-createFile':
        return await this.createFile(toolArgs);
      
      case 'paypilot-updateFile':
        return await this.updateFile(toolArgs);
      
      case 'paypilot-deleteFile':
        return await this.deleteFile(toolArgs);
      
      case 'paypilot-createDirectory':
        return await this.createDirectory(toolArgs);
      
      case 'paypilot-deleteDirectory':
        return await this.deleteDirectory(toolArgs);
      
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // Helper methods (same as before)

  private async readFileSnapshot(uri: vscode.Uri): Promise<{ content: string; exists: boolean }> {
    try {
      const buffer = await vscode.workspace.fs.readFile(uri);
      return { content: Buffer.from(buffer).toString("utf8"), exists: true };
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return { content: "", exists: false };
      }
      throw error;
    }
  }

  private async readFileAfterTool(uri: vscode.Uri): Promise<string> {
    const buffer = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(buffer).toString("utf8");
  }

  private async captureDirectorySnapshot(uri: vscode.Uri): Promise<string | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (!(stat.type & vscode.FileType.Directory)) {
        return undefined;
      }
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return undefined;
      }
      throw error;
    }

    const entries: Array<{ path: string; type: 'file' | 'directory'; content?: string }> = [];
    await this.collectDirectoryEntries(uri, uri, entries);
    return JSON.stringify(entries);
  }

  private async collectDirectoryEntries(
    baseUri: vscode.Uri,
    currentUri: vscode.Uri,
    entries: Array<{ path: string; type: 'file' | 'directory'; content?: string }>
  ): Promise<void> {
    const relative = path
      .relative(baseUri.fsPath, currentUri.fsPath)
      .replace(/\\/g, '/');
    if (relative && relative !== '') {
      entries.push({ path: relative, type: 'directory' });
    }

    const children = await vscode.workspace.fs.readDirectory(currentUri);
    for (const [name, type] of children) {
      const childUri = vscode.Uri.joinPath(currentUri, name);
      if (type & vscode.FileType.Directory) {
        await this.collectDirectoryEntries(baseUri, childUri, entries);
      } else if (type & vscode.FileType.File) {
        const content = await vscode.workspace.fs.readFile(childUri);
        const relativeChild = path
          .relative(baseUri.fsPath, childUri.fsPath)
          .replace(/\\/g, '/');
        entries.push({
          path: relativeChild,
          type: 'file',
          content: Buffer.from(content).toString('base64'),
        });
      }
    }
  }

  private async getWorkspaceContext(args: { path?: string; maxDepth?: number }): Promise<any> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri;
    if (!workspaceRoot) {
      return { error: "No workspace open" };
    }

    const targetPath = args.path || '.';
    const targetUri = resolveWorkspaceUri(targetPath);
    const maxDepth = args.maxDepth || 3;

    const structure = await this.buildDirectoryTree(targetUri, maxDepth, 0);
    
    return {
      path: targetPath,
      structure: structure,
      workspaceRoot: workspaceRoot.fsPath
    };
  }

  private async buildDirectoryTree(uri: vscode.Uri, maxDepth: number, currentDepth: number): Promise<any> {
    if (currentDepth >= maxDepth) {
      return null;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      
      if (stat.type === vscode.FileType.File) {
        return {
          name: path.basename(uri.fsPath),
          type: 'file',
          path: uri.fsPath
        };
      }

      const entries = await vscode.workspace.fs.readDirectory(uri);
      const children = await Promise.all(
        entries
          .filter(([name]) => !name.startsWith('.') && name !== 'node_modules')
          .map(async ([name, type]) => {
            const childUri = vscode.Uri.joinPath(uri, name);
            if (type === vscode.FileType.Directory) {
              return await this.buildDirectoryTree(childUri, maxDepth, currentDepth + 1);
            }
            return {
              name,
              type: 'file',
              path: childUri.fsPath
            };
          })
      );

      return {
        name: path.basename(uri.fsPath),
        type: 'directory',
        path: uri.fsPath,
        children: children.filter(Boolean)
      };
    } catch (error) {
      return { error: `Failed to read: ${uri.fsPath}` };
    }
  }

  private async readFile(args: { path: string }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);
    
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      return {
        path: args.path,
        content: Buffer.from(content).toString('utf8'),
        success: true
      };
    } catch (error) {
      return {
        path: args.path,
        error: error instanceof Error ? error.message : String(error),
        success: false
      };
    }
  }

  private async createFile(args: { path: string; content: string }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);
    
    try {
      const content = Buffer.from(args.content, 'utf8');
      await vscode.workspace.fs.writeFile(uri, content);
      
      return {
        path: args.path,
        operation: 'create',
        success: true,
        message: `Created ${path.basename(args.path)}`
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async updateFile(args: { path: string; content: string }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);
    
    try {
      const content = Buffer.from(args.content, 'utf8');
      await vscode.workspace.fs.writeFile(uri, content);
      
      return {
        path: args.path,
        operation: 'update',
        success: true,
        message: `Updated ${path.basename(args.path)}`
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async deleteFile(args: { path: string }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);
    
    try {
      await vscode.workspace.fs.delete(uri);
      
      return {
        path: args.path,
        operation: 'delete',
        success: true,
        message: `Deleted ${path.basename(args.path)}`
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async createDirectory(args: { path: string }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);
    
    try {
      await vscode.workspace.fs.createDirectory(uri);
      
      return {
        path: args.path,
        operation: 'create_directory',
        success: true,
        message: `Created directory ${path.basename(args.path)}`
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async deleteDirectory(args: { path: string; recursive?: boolean }): Promise<any> {
    const uri = resolveWorkspaceUri(args.path);
    
    try {
      await vscode.workspace.fs.delete(uri, { recursive: args.recursive ?? true });
      
      return {
        path: args.path,
        operation: 'delete_directory',
        success: true,
        message: `Deleted directory ${path.basename(args.path)}`
      };
    } catch (error) {
      return {
        path: args.path,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  start(port?: number): Promise<void> {
    if (port) {
      this.port = port;
    }

    return new Promise((resolve, reject) => {
      this.server = this.setupServer();
      
      // Explicitly bind to 127.0.0.1
      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[ToolServer] Running on http://127.0.0.1:${this.port}`);
        resolve();
      });
      
      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          console.log(`[ToolServer] Port ${this.port} in use, trying ${this.port + 1}`);
          this.port++;
          this.start().then(resolve).catch(reject);
        } else {
          reject(error);
        }
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  dispose() {
    if (this.server) {
      this.server.close();
      console.log('[ToolServer] Stopped');
    }
  }
}
