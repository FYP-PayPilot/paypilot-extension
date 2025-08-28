import * as vscode from 'vscode';
import { getWebviewHtml } from '../services/html';

/**
 * Webview provider for the PayPilot chat interface.
 * Bridges VS Code extension APIs with React chat UI.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private listeners: Array<(msg: any, panel: vscode.Webview) => void> = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Configures webview with React app and sets up message routing.
   * Called by VS Code when the chat panel is opened.
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    const webview = webviewView.webview;

    // Configure webview security and permissions
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    // Generate secure URIs for React bundle
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'webview.js')
    );
    
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'global.css')
    );

    // Generate HTML document for React app
    webview.html = getWebviewHtml(webview, this.context.extensionUri, { scriptUri, styleUri });

    // Route messages from React to registered listeners
    webview.onDidReceiveMessage((msg) => {
      this.listeners.forEach(l => l(msg, webview));
    });
  }

  /**
   * Registers message listener for webview communication.
   * Used by extension.ts to handle chat requests and other UI events.
   */
  onMessage(listener: (msg: any, panel: vscode.Webview) => void) {
    this.listeners.push(listener);
  }

  /**
   * Sends messages from extension to React UI.
   * Safe to call even if webview is not initialized.
   */
  postMessage(message: any) {
    this._view?.webview.postMessage(message);
  }
}