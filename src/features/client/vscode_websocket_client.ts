/**
 * VSCode Extension WebSocket Client
 * Connects to the FastAPI WebSocket endpoint for agent communication
 */

import * as vscode from 'vscode';
import WebSocket from 'ws';

interface ToolRequest {
    type: 'tool_request';
    request_id: string;
    tool_name: string;
    tool_args: Record<string, any>;
    workspace_root: string;
}

interface AgentResponse {
    type: 'agent_response';
    response: string;
    model_used: string;
    stats: {
        iterations: number;
        tool_calls: number;
        tokens_used: number;
    };
}

interface StatusUpdate {
    type: 'status';
    message: string;
}

interface ErrorMessage {
    type: 'error';
    message: string;
}

type ServerMessage = ToolRequest | AgentResponse | StatusUpdate | ErrorMessage | { type: 'pong' };

export class AgentWebSocketClient {
    private ws: WebSocket | null = null;
    private serverUrl: string;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;
    private pingInterval: NodeJS.Timeout | null = null;
    
    // Callbacks for UI updates
    public onStatusUpdate?: (message: string) => void;
    public onResponse?: (response: AgentResponse) => void;
    public onError?: (error: string) => void;
    public onConnectionChange?: (connected: boolean) => void;

    constructor(serverUrl: string = 'ws://localhost:8000/ws/agent') {
        this.serverUrl = serverUrl;
    }

    /**
     * Connect to the WebSocket server
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.onopen = () => {
                    console.log('WebSocket connected to server');
                    this.reconnectAttempts = 0;
                    this.startPingInterval();
                    this.onConnectionChange?.(true);
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data.toString());
                };

                this.ws.onclose = (event) => {
                    console.log('WebSocket closed:', event.code, event.reason);
                    this.stopPingInterval();
                    this.onConnectionChange?.(false);
                    this.attemptReconnect();
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.onError?.('WebSocket connection error');
                    reject(error);
                };

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Disconnect from the server
     */
    disconnect(): void {
        this.stopPingInterval();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Send an agent request to the server
     */
    async sendAgentRequest(request: {
        model_id: string;
        user_prompt: string;
        editor_context?: Record<string, any>;
        file_context?: any[];
        workspace_root?: string;
        max_tokens?: number;
        temperature?: number;
    }): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        this.ws.send(JSON.stringify({
            type: 'agent_request',
            ...request
        }));
    }

    /**
     * Handle incoming messages from server
     */
    private async handleMessage(data: string): Promise<void> {
        try {
            const message: ServerMessage = JSON.parse(data);

            switch (message.type) {
                case 'tool_request':
                    await this.handleToolRequest(message);
                    break;

                case 'agent_response':
                    this.onResponse?.(message);
                    break;

                case 'status':
                    this.onStatusUpdate?.(message.message);
                    break;

                case 'error':
                    this.onError?.(message.message);
                    break;

                case 'pong':
                    // Keep-alive response, ignore
                    break;

                default:
                    console.warn('Unknown message type:', message);
            }
        } catch (error) {
            console.error('Failed to parse message:', error);
        }
    }

    /**
     * Execute a tool locally and send result back
     */
    private async handleToolRequest(request: ToolRequest): Promise<void> {
        console.log(`Executing tool: ${request.tool_name}`, request.tool_args);
        
        try {
            const result = await this.executeLocalTool(
                request.tool_name,
                request.tool_args,
                request.workspace_root
            );

            // Send result back to server
            this.ws?.send(JSON.stringify({
                type: 'tool_result',
                request_id: request.request_id,
                result: result
            }));

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            this.ws?.send(JSON.stringify({
                type: 'tool_result',
                request_id: request.request_id,
                result: JSON.stringify({ error: errorMessage })
            }));
        }
    }

    /**
     * Execute VSCode-specific tools
     * This is where you implement your actual tool logic
     */
    private async executeLocalTool(
        toolName: string,
        args: Record<string, any>,
        workspaceRoot: string
    ): Promise<string> {
        switch (toolName) {
            case 'read_file':
                return await this.readFile(args.path, workspaceRoot);

            case 'write_file':
                return await this.writeFile(args.path, args.content, workspaceRoot);

            case 'list_directory':
                return await this.listDirectory(args.path, workspaceRoot);

            case 'search_files':
                return await this.searchFiles(args.pattern, args.path, workspaceRoot);

            case 'get_diagnostics':
                return await this.getDiagnostics(args.path);

            case 'run_terminal_command':
                return await this.runTerminalCommand(args.command, workspaceRoot);

            case 'get_workspace_info':
                return await this.getWorkspaceInfo();

            case 'open_file':
                return await this.openFile(args.path, workspaceRoot);

            case 'get_selection':
                return await this.getSelection();

            case 'replace_selection':
                return await this.replaceSelection(args.content);

            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // ========================================================================
    // TOOL IMPLEMENTATIONS
    // ========================================================================

    private async readFile(relativePath: string, workspaceRoot: string): Promise<string> {
        const uri = vscode.Uri.file(`${workspaceRoot}/${relativePath}`);
        const content = await vscode.workspace.fs.readFile(uri);
        return JSON.stringify({
            success: true,
            content: Buffer.from(content).toString('utf-8')
        });
    }

    private async writeFile(relativePath: string, content: string, workspaceRoot: string): Promise<string> {
        const uri = vscode.Uri.file(`${workspaceRoot}/${relativePath}`);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
        return JSON.stringify({
            success: true,
            message: `File written: ${relativePath}`
        });
    }

    private async listDirectory(relativePath: string, workspaceRoot: string): Promise<string> {
        const uri = vscode.Uri.file(`${workspaceRoot}/${relativePath}`);
        const entries = await vscode.workspace.fs.readDirectory(uri);
        
        const files = entries.map(([name, type]) => ({
            name,
            type: type === vscode.FileType.Directory ? 'directory' : 'file'
        }));

        return JSON.stringify({ success: true, files });
    }

    private async searchFiles(pattern: string, searchPath: string, workspaceRoot: string): Promise<string> {
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceRoot, `${searchPath}/**/${pattern}`)
        );

        return JSON.stringify({
            success: true,
            files: files.map(f => f.fsPath.replace(workspaceRoot, ''))
        });
    }

    private async getDiagnostics(filePath?: string): Promise<string> {
        let diagnostics: [vscode.Uri, readonly vscode.Diagnostic[]][];
        
        if (filePath) {
            const uri = vscode.Uri.file(filePath);
            const fileDiagnostics = vscode.languages.getDiagnostics(uri);
            diagnostics = [[uri, fileDiagnostics]];
        } else {
            diagnostics = vscode.languages.getDiagnostics();
        }

        const result = diagnostics.map(([uri, diags]) => ({
            file: uri.fsPath,
            issues: diags.map(d => ({
                message: d.message,
                severity: vscode.DiagnosticSeverity[d.severity],
                line: d.range.start.line + 1,
                column: d.range.start.character + 1
            }))
        }));

        return JSON.stringify({ success: true, diagnostics: result });
    }

    private async runTerminalCommand(command: string, cwd: string): Promise<string> {
        return new Promise((resolve) => {
            const terminal = vscode.window.createTerminal({
                name: 'Agent Command',
                cwd: cwd
            });
            
            terminal.sendText(command);
            terminal.show();

            // Note: Getting actual output requires terminal API access
            // This is a simplified version
            resolve(JSON.stringify({
                success: true,
                message: `Command executed: ${command}`
            }));
        });
    }

    private async getWorkspaceInfo(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        return JSON.stringify({
            success: true,
            workspace: {
                folders: workspaceFolders?.map(f => ({
                    name: f.name,
                    path: f.uri.fsPath
                })) || [],
                name: vscode.workspace.name
            }
        });
    }

    private async openFile(relativePath: string, workspaceRoot: string): Promise<string> {
        const uri = vscode.Uri.file(`${workspaceRoot}/${relativePath}`);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        return JSON.stringify({
            success: true,
            message: `Opened: ${relativePath}`
        });
    }

    private async getSelection(): Promise<string> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return JSON.stringify({
                success: false,
                error: 'No active editor'
            });
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        return JSON.stringify({
            success: true,
            text: selectedText,
            file: editor.document.fileName,
            startLine: selection.start.line + 1,
            endLine: selection.end.line + 1
        });
    }

    private async replaceSelection(content: string): Promise<string> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return JSON.stringify({
                success: false,
                error: 'No active editor'
            });
        }

        await editor.edit(editBuilder => {
            editBuilder.replace(editor.selection, content);
        });

        return JSON.stringify({
            success: true,
            message: 'Selection replaced'
        });
    }

    // ========================================================================
    // CONNECTION MANAGEMENT
    // ========================================================================

    private startPingInterval(): void {
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000); // Ping every 30 seconds
    }

    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
            this.connect().catch(err => {
                console.error('Reconnection failed:', err);
            });
        }, delay);
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}


// ============================================================================
// USAGE EXAMPLE IN EXTENSION
// ============================================================================

export function createAgentClient(context: vscode.ExtensionContext): AgentWebSocketClient {
    const config = vscode.workspace.getConfiguration('yourExtension');
    const serverUrl = config.get<string>('serverUrl', 'ws://localhost:8000/ws/agent');
    
    const client = new AgentWebSocketClient(serverUrl);

    // Set up UI callbacks
    client.onStatusUpdate = (message) => {
        vscode.window.setStatusBarMessage(`Agent: ${message}`, 3000);
    };

    client.onResponse = (response) => {
        // Display response in output channel or webview
        const outputChannel = vscode.window.createOutputChannel('AI Agent');
        outputChannel.appendLine('=== Agent Response ===');
        outputChannel.appendLine(response.response);
        outputChannel.appendLine(`\nStats: ${JSON.stringify(response.stats)}`);
        outputChannel.show();
    };

    client.onError = (error) => {
        vscode.window.showErrorMessage(`Agent Error: ${error}`);
    };

    client.onConnectionChange = (connected) => {
        if (connected) {
            vscode.window.showInformationMessage('Connected to AI Agent server');
        } else {
            vscode.window.showWarningMessage('Disconnected from AI Agent server');
        }
    };

    // Connect on activation
    client.connect().catch(err => {
        console.error('Initial connection failed:', err);
    });

    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: () => client.disconnect()
    });

    return client;
}


// ============================================================================
// COMMAND EXAMPLE
// ============================================================================

export function registerAgentCommand(
    context: vscode.ExtensionContext,
    client: AgentWebSocketClient
): void {
    const command = vscode.commands.registerCommand(
        'yourExtension.askAgent',
        async () => {
            if (!client.isConnected) {
                vscode.window.showErrorMessage('Not connected to agent server');
                return;
            }

            const prompt = await vscode.window.showInputBox({
                prompt: 'What would you like the AI agent to do?',
                placeHolder: 'e.g., Refactor the selected code to use async/await'
            });

            if (!prompt) return;

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            // Get current editor context
            const editor = vscode.window.activeTextEditor;
            const editorContext = editor ? {
                file: editor.document.fileName,
                language: editor.document.languageId,
                selection: editor.document.getText(editor.selection),
                lineCount: editor.document.lineCount
            } : {};

            try {
                await client.sendAgentRequest({
                    model_id: 'claude-sonnet-4-20250514',  // or get from settings
                    user_prompt: prompt,
                    editor_context: editorContext,
                    workspace_root: workspaceFolder.uri.fsPath,
                    max_tokens: 4000,
                    temperature: 0.7
                });

                vscode.window.showInformationMessage('Agent request sent...');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to send request: ${error}`);
            }
        }
    );

    context.subscriptions.push(command);
}
