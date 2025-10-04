import * as vscode from "vscode";
import express from "express";
import * as path from "path";
import { resolveWorkspaceUri } from "../../utils/workspace";

export class ToolExecutionServer {
  private app: express.Application;
  private server: any;
  private port: number = 3001;

  constructor() {
    this.app = express();
    this.app.use(express.json({ limit: '50mb' }));
    
    // CORS for local backend
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    this.setupRoutes();
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
    });

    // Main tool execution endpoint
    this.app.post('/execute-tool', async (req, res) => {
      const { toolName, toolArgs } = req.body;
      
      console.log(`[ToolServer] Executing: ${toolName}`, toolArgs);
      
      try {
        const result = await this.executeToolLocally(toolName, toolArgs);
        res.json({ success: true, result });
      } catch (error) {
        console.error(`[ToolServer] Error:`, error);
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

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
      try {
        this.server = this.app.listen(this.port, () => {
          console.log(`[ToolServer] Running on http://localhost:${this.port}`);
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
      } catch (error) {
        reject(error);
      }
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