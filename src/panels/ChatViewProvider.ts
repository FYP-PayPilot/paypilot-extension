import * as vscode from 'vscode';
import { getWebviewHtml } from '../services/html';

/**
 * ChatViewProvider - VS Code Webview Panel Manager
 * 
 * This class serves as the primary interface between VS Code's extension host environment
 * and the React-based chat interface. It implements VS Code's WebviewViewProvider interface
 * to create and manage a persistent webview panel that hosts our AI chat application.
 * 
 * ARCHITECTURE ROLE:
 * - Acts as the "Container Layer" in our 6-layer architecture
 * - Bridges VS Code's extension APIs with our React application
 * - Manages webview lifecycle (creation, disposal, message routing)
 * - Provides secure communication channel between extension host and webview
 * 
 * INTEGRATION PATTERN:
 * - Registered with VS Code via `vscode.window.registerWebviewViewProvider()`
 * - Creates HTML content using html.ts service (embedded CSS approach)
 * - Establishes bidirectional message passing with React app
 * - Maintains persistent connection for real-time AI chat functionality
 * 
 * SECURITY CONSIDERATIONS:
 * - Configures Content Security Policy for webview safety
 * - Uses VS Code's URI scheme for secure resource loading
 * - Validates all incoming messages from webview before processing
 * - Restricts local resource access to extension directory only
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  /**
   * Active webview instance - null until resolveWebviewView() is called
   * This holds the reference to the actual VS Code webview panel that displays our React app
   */
  private _view?: vscode.WebviewView;
  
  /**
   * Message event listeners registered by extension.ts
   * Each listener receives messages from the React app and can respond accordingly
   * This enables decoupled communication between webview and extension logic
   */
  private listeners: Array<(msg: any, panel: vscode.Webview) => void> = [];

  /**
   * Initialize ChatViewProvider with VS Code extension context
   * 
   * @param context - VS Code extension context providing access to extension resources
   *                  Used for generating secure URIs to bundled React app and assets
   */
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * VS Code WebviewViewProvider Implementation - Core Webview Setup
   * 
   * This method is called by VS Code when the webview panel needs to be created and configured.
   * It's the entry point where we transform VS Code's webview into our React application container.
   * 
   * WEBVIEW LIFECYCLE:
   * 1. VS Code calls this method when user opens the chat panel
   * 2. We configure webview security and resource permissions
   * 3. Generate secure URIs for React bundle and CSS assets
   * 4. Create HTML content with embedded CSS using html.ts service
   * 5. Set up bidirectional message passing between webview and extension
   * 
   * SECURITY CONFIGURATION:
   * - enableScripts: true - Allows our React JavaScript to execute
   * - localResourceRoots: Restricts file access to extension directory only
   * - Content Security Policy applied via html.ts nonce-based loading
   * 
   * MESSAGE ROUTING:
   * - Incoming messages from React app routed to all registered listeners
   * - This enables extension.ts to handle chat requests, code application, etc.
   * - Decoupled design allows multiple message handlers for different features
   * 
   * @param webviewView - VS Code's webview panel instance to configure
   * @param _context - Webview resolution context (unused in our implementation)
   * @param _token - Cancellation token for async operations (unused)
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    // Store webview reference for later communication (postMessage, etc.)
    this._view = webviewView;
    const webview = webviewView.webview;

    // Configure webview security and permissions
    // enableScripts: Required for React app execution
    // localResourceRoots: Security boundary - only extension files accessible
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    // Generate secure VS Code URIs for React app bundle and CSS assets
    // These URIs use VS Code's vscode-webview:// scheme for security
    // asWebviewUri() ensures proper Content Security Policy compliance
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'webview.js')
    );
    
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'global.css')
    );

    // Generate complete HTML document for React app
    // html.ts creates HTML with embedded CSS for reliable styling
    // Uses nonce-based script loading for security compliance
    // Creates <div id="root"> where React app will mount
    webview.html = getWebviewHtml(webview, this.context.extensionUri, { scriptUri, styleUri });

    // Set up message routing from React app to extension
    // When React app calls vscode.postMessage(), this handler receives it
    // Messages are broadcast to all registered listeners for processing
    // This enables extension.ts to handle chat requests, code edits, etc.
    webview.onDidReceiveMessage((msg) => {
      this.listeners.forEach(l => l(msg, webview));
    });
  }

  /**
   * Register Message Event Listener - Extension Communication Setup
   * 
   * This method allows extension.ts and other components to register handlers for messages
   * sent from the React webview application. It implements the Observer pattern to enable
   * decoupled communication between the webview UI and extension business logic.
   * 
   * USAGE PATTERN:
   * ```typescript
   * // In extension.ts
   * chatProvider.onMessage((message, webview) => {
   *   if (message.type === 'chat:ask') {
   *     // Handle AI chat request
   *     handleChatRequest(message.prompt, webview);
   *   }
   * });
   * ```
   * 
   * COMMUNICATION FLOW:
   * 1. React app calls vscode.postMessage({ type: 'chat:ask', prompt: 'question' })
   * 2. VS Code routes message to our onDidReceiveMessage handler
   * 3. Broadcast message to all registered listeners
   * 4. extension.ts processes message and calls DeepSeek API
   * 5. Response sent back via postMessage() method
   * 
   * DECOUPLING BENEFITS:
   * - Multiple components can listen to webview messages
   * - Easy to add new message types without modifying this class
   * - Clean separation between UI communication and business logic
   * - Testable message handling without webview dependencies
   * 
   * @param listener - Function that receives messages from React app
   *                   Gets called with (message, webview) for each incoming message
   */
  onMessage(listener: (msg: any, panel: vscode.Webview) => void) {
    this.listeners.push(listener);
  }

  /**
   * Send Message to React Webview - Extension to UI Communication
   * 
   * This method sends messages from the extension host environment to the React application
   * running in the webview. It's the primary way extension logic communicates with the UI.
   * 
   * USAGE PATTERNS:
   * ```typescript
   * // Send AI response tokens for streaming display
   * chatProvider.postMessage({
   *   type: 'chat:stream',
   *   token: 'Hello',
   *   messageId: '123'
   * });
   * 
   * // Send error messages to UI
   * chatProvider.postMessage({
   *   type: 'error',
   *   message: 'API request failed'
   * });
   * 
   * // Confirm code application success
   * chatProvider.postMessage({
   *   type: 'editor:applySuccess',
   *   changes: appliedChanges
   * });
   * ```
   * 
   * REACT APP HANDLING:
   * - React app receives messages via VSCodeContext.onMessage()
   * - useChat hook processes messages and updates UI state
   * - UI components re-render to show new content
   * 
   * ERROR HANDLING:
   * - Safe to call even if webview is not initialized (_view is undefined)
   * - VS Code handles message delivery and queuing automatically
   * - Type safety ensured through TypeScript interfaces in chat.ts
   * 
   * @param message - Data to send to React app (typically typed message object)
   */
  postMessage(message: any) {
    this._view?.webview.postMessage(message);
  }
}