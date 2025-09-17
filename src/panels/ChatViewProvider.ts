/** ChatViewProvider.ts (sourced from below link with modifications)
 * https://github.com/microsoft/vscode-extension-samples/blob/main/webview-view-sample/src/extension.ts
  * Webview View for the PayPilot chat interface.
 * Bridges VS Code extension APIs with React chat UI.
 */

import * as vscode from 'vscode';
import { getWebviewHtml } from '../services/html';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  
  private _view?: vscode.WebviewView;

  // callback function that handles messages sent from react webview to the extension
  private messageHandler?: (msg: any, panel: vscode.Webview) => void;
  
  // callback function to notify when panel visibility changes
  private visibilityChangeCallback?: (visible: boolean) => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Set callback for when panel visibility changes
   */
  public onVisibilityChange(callback: (visible: boolean) => void) {
    this.visibilityChangeCallback = callback;
  }

  /**
   * Configures webview with React app and sets up message routing.
   * Called by VS Code when the chat panel is opened.
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {

    this._view = webviewView; // webviewView is the container that holds the webview (picture frame)

    const webview = webviewView.webview; // webview is the actual content area where React app runs (the actual picture)

    // Track visibility changes
    webviewView.onDidChangeVisibility(() => {
      const isVisible = webviewView.visible;
      this.visibilityChangeCallback?.(isVisible);
    });

    // Track disposal
    webviewView.onDidDispose(() => {
      this.visibilityChangeCallback?.(false);
    });

    // Initial visibility state
    this.visibilityChangeCallback?.(webviewView.visible);

    // Configure webview security and permissions
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    // Generate secure URIs for React bundle to load within sandboxed webview
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'webview.js')
    );
    
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'global.css')
    );

    // Generate HTML document for React app and pass in secure URIs
    webview.html = getWebviewHtml(webview, this.context.extensionUri, { scriptUri, styleUri });

    // Route messages from React to the registered handler
    webview.onDidReceiveMessage((msg) => {
      this.messageHandler?.(msg, webview);
    });
  }

  /**
   * Registers message listener for webview communication.
   * Used by extension.ts to handle chat requests and other UI events.
   */
  public onMessage(listener: (msg: any, panel: vscode.Webview) => void) {
    this.messageHandler = listener;
  }

  /**
   * Sends messages from extension to React UI.
   * Safe to call even if webview is not initialized.
   */
  public postMessage(message: any) {
    this._view?.webview.postMessage(message);
  }
}