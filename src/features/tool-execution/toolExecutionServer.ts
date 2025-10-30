import * as vscode from "vscode";
import * as http from "http";
import * as path from "path";
import { resolveWorkspaceUri } from "../../utils/workspace";

/**
 * Comprehensive result returned from tool execution with all tracking information
 */
interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  
  // Before state (for diff tracking)
  beforeState?: {
    content: string;
    exists: boolean;
    isDirectory?: boolean;
    directorySnapshot?: string;
  };
  
  // After state (for diff tracking)
  afterState?: {
    content: string;
    exists: boolean;
    isDirectory?: boolean;
  };
  
  // Tool metadata for UI notifications
  toolMetadata?: {
    fileName: string;
    filePath: string;
    relativePath: string;
    operation: 'create' | 'update' | 'delete' | 'read' | 'directory' | 'directory-delete' | 'context';
  };
  
  // Diff statistics for change summary
  diffStats?: {
    linesAdded: number;
    linesDeleted: number;
  };
  
  // Activity description for real-time UI updates
  activity?: {
    title: string;
    detail?: string;
    operation: string;
  };
}

export class ToolExecutionServer {
  private server: http.Server | undefined;
  private port: number = 3001;

  constructor() {}

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

            const result = await this.executeToolWithTracking(toolName, toolArgs);
            
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
   * Execute tool with comprehensive tracking for agent mode.
   * Captures before/after state, calculates diffs, and provides activity descriptions.
   */
  private async executeToolWithTracking(toolName: string, toolArgs: any): Promise<ToolExecutionResult> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceRoot) {
      return {
        success: false,
        error: "No workspace folder open"
      };
    }

    try {
      // Step 1: Capture "before" state
      const beforeState = await this.captureBeforeState(toolName, toolArgs);

      // Step 2: Execute the tool
      const executionResult = await this.executeToolLocally(toolName, toolArgs);

      // Step 3: Capture "after" state
      const afterState = await this.captureAfterState(toolName, toolArgs);

      // Step 4: Calculate diff statistics
      const diffStats = this.calculateDiffStats(beforeState, afterState);

      // Step 5: Generate metadata and activity description
      const toolMetadata = this.generateToolMetadata(toolName, toolArgs, beforeState);
      const activity = this.describeToolActivity(toolName, toolArgs, toolMetadata);

      // Step 6: Return comprehensive result
      return {
        success: true,
        result: executionResult,
        beforeState,
        afterState,
        toolMetadata,
        diffStats,
        activity
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        activity: {
          title: `Failed to execute ${toolName}`,
          detail: error instanceof Error ? error.message : String(error),
          operation: 'error'
        }
      };
    }
  }

  /**
   * Capture file/directory state BEFORE tool execution.
   * Similar to prepareToolContext in messageHandlerService.
   */
  private async captureBeforeState(toolName: string, toolArgs: any): Promise<ToolExecutionResult['beforeState']> {
    if (toolName === 'paypilot-workspaceContext' || !toolArgs.path) {
      return undefined;
    }

    const uri = resolveWorkspaceUri(toolArgs.path);

    switch (toolName) {
      case 'paypilot-createFile':
      case 'paypilot-updateFile':
      case 'paypilot-deleteFile':
      case 'paypilot-readFile': {
        const snapshot = await this.readFileSnapshot(uri);
        return {
          content: snapshot.content,
          exists: snapshot.exists,
          isDirectory: false
        };
      }

      case 'paypilot-createDirectory':
      case 'paypilot-deleteDirectory': {
        const directorySnapshot = await this.captureDirectorySnapshot(uri);
        return {
          content: '',
          exists: directorySnapshot !== undefined,
          isDirectory: true,
          directorySnapshot
        };
      }

      default:
        return undefined;
    }
  }

  /**
   * Capture file/directory state AFTER tool execution.
   */
  private async captureAfterState(toolName: string, toolArgs: any): Promise<ToolExecutionResult['afterState']> {
    if (toolName === 'paypilot-workspaceContext' || !toolArgs.path) {
      return undefined;
    }

    const uri = resolveWorkspaceUri(toolArgs.path);

    switch (toolName) {
      case 'paypilot-createFile':
      case 'paypilot-updateFile':
      case 'paypilot-readFile': {
        const snapshot = await this.readFileSnapshot(uri);
        return {
          content: snapshot.content,
          exists: snapshot.exists,
          isDirectory: false
        };
      }

      case 'paypilot-deleteFile': {
        return {
          content: '',
          exists: false,
          isDirectory: false
        };
      }

      case 'paypilot-createDirectory': {
        const exists = await this.checkDirectoryExists(uri);
        return {
          content: '',
          exists,
          isDirectory: true
        };
      }

      case 'paypilot-deleteDirectory': {
        return {
          content: '',
          exists: false,
          isDirectory: true
        };
      }

      default:
        return undefined;
    }
  }

  /**
   * Read file content and check existence.
   */
  private async readFileSnapshot(uri: vscode.Uri): Promise<{ content: string; exists: boolean }> {
    try {
      const buffer = await vscode.workspace.fs.readFile(uri);
      return { 
        content: Buffer.from(buffer).toString("utf8"), 
        exists: true 
      };
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return { content: "", exists: false };
      }
      throw error;
    }
  }

  /**
   * Check if directory exists.
   */
  private async checkDirectoryExists(uri: vscode.Uri): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return (stat.type & vscode.FileType.Directory) !== 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Capture complete directory structure as JSON snapshot.
   */
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

  /**
   * Recursively collect directory entries.
   */
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

  /**
   * Calculate diff statistics between before and after states.
   * Similar to DiffService.calculateDiffStats.
   */
  private calculateDiffStats(
    beforeState?: ToolExecutionResult['beforeState'],
    afterState?: ToolExecutionResult['afterState']
  ): ToolExecutionResult['diffStats'] {
    if (!beforeState || !afterState || beforeState.isDirectory) {
      return undefined;
    }

    const beforeLines = beforeState.content.split('\n');
    const afterLines = afterState.content.split('\n');

    // Simple line-by-line diff calculation
    const maxLines = Math.max(beforeLines.length, afterLines.length);
    let added = 0;
    let deleted = 0;

    // Count new lines added
    if (afterLines.length > beforeLines.length) {
      added = afterLines.length - beforeLines.length;
    }

    // Count lines deleted
    if (beforeLines.length > afterLines.length) {
      deleted = beforeLines.length - afterLines.length;
    }

    // Count modified lines (simple approach - compare line by line)
    const minLines = Math.min(beforeLines.length, afterLines.length);
    for (let i = 0; i < minLines; i++) {
      if (beforeLines[i] !== afterLines[i]) {
        // Line was modified - count as both added and deleted
        added++;
        deleted++;
      }
    }

    return {
      linesAdded: added,
      linesDeleted: deleted
    };
  }

  /**
   * Generate tool metadata for tracking.
   */
  private generateToolMetadata(
    toolName: string,
    toolArgs: any,
    beforeState?: ToolExecutionResult['beforeState']
  ): ToolExecutionResult['toolMetadata'] {
    if (toolName === 'paypilot-workspaceContext' || !toolArgs.path) {
      return undefined;
    }

    const uri = resolveWorkspaceUri(toolArgs.path);
    const fileName = path.basename(uri.fsPath);
    const relativePath = this.getRelativePath(uri);

    let operation: 'create' | 'update' | 'delete' | 'read' | 'directory' | 'directory-delete' | 'context' = 'update';

    switch (toolName) {
      case 'paypilot-createFile':
        operation = beforeState?.exists ? 'update' : 'create';
        break;
      case 'paypilot-updateFile':
        operation = 'update';
        break;
      case 'paypilot-deleteFile':
        operation = 'delete';
        break;
      case 'paypilot-readFile':
        operation = 'read';
        break;
      case 'paypilot-createDirectory':
        operation = 'directory';
        break;
      case 'paypilot-deleteDirectory':
        operation = 'directory-delete';
        break;
    }

    return {
      fileName,
      filePath: uri.fsPath,
      relativePath,
      operation
    };
  }

  /**
   * Generate activity description for UI notifications.
   * Similar to describeToolActivity in messageHandlerService.
   */
  private describeToolActivity(
    toolName: string,
    toolArgs: any,
    metadata?: ToolExecutionResult['toolMetadata']
  ): ToolExecutionResult['activity'] {
    if (toolName === 'paypilot-workspaceContext') {
      return {
        title: 'Gathering workspace context…',
        operation: 'context'
      };
    }

    if (!metadata) {
      if (toolName === 'paypilot-readFile') {
        return { 
          title: 'Reading workspace data', 
          operation: 'read' 
        };
      }
      return {
        title: `Executing ${toolName}`,
        operation: 'unknown'
      };
    }

    const { fileName, relativePath, operation } = metadata;

    switch (operation) {
      case 'create':
        return {
          title: `${fileName} created`,
          detail: relativePath,
          operation: 'create'
        };
      case 'update':
        return {
          title: `${fileName} updated`,
          detail: relativePath,
          operation: 'update'
        };
      case 'delete':
        return {
          title: `${fileName} deleted`,
          detail: relativePath,
          operation: 'delete'
        };
      case 'read':
        return {
          title: `${fileName} read`,
          detail: relativePath,
          operation: 'read'
        };
      case 'directory':
        return {
          title: `${fileName || relativePath} directory created`,
          detail: relativePath,
          operation: 'directory'
        };
      case 'directory-delete':
        return {
          title: `${fileName || relativePath} directory deleted`,
          detail: relativePath,
          operation: 'directory-delete'
        };
      default:
        return {
          title: `${fileName} ${operation}`,
          detail: relativePath,
          operation
        };
    }
  }

  /**
   * Get relative path from workspace root.
   */
  private getRelativePath(uri: vscode.Uri): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return uri.fsPath;
    }
    return path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/');
  }

  /**
   * Execute tool locally (actual file system operations).
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
