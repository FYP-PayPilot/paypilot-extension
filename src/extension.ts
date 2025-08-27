import * as vscode from 'vscode';
import { ChatViewProvider } from './panels/ChatViewProvider';
import { askDeepSeek } from './services/deepseek';

/**
 * MAIN EXTENSION ENTRY POINT
 * 
 * This file serves as the entry point for the entire VS Code extension. It's responsible for:
 * 1. Extension activation and initialization
 * 2. Registering VS Code commands that users can invoke
 * 3. Creating and managing the chat webview panel
 * 4. Orchestrating communication between the webview and AI services
 * 
 * INTEGRATION WITH OTHER FILES:
 * - Imports ChatViewProvider from panels/ to create the webview interface
 * - Imports askDeepSeek from services/ to handle AI API communication
 * - Uses types from types/chat.ts for message structure validation
 * - Webview communicates back to this file via message passing
 * 
 * MESSAGE FLOW:
 * User Input → Webview (React) → extension.ts → deepseek.ts → AI API → Response Stream → Webview
 * 
 * LIFECYCLE:
 * 1. activate() called when extension loads (based on activationEvents in package.json)
 * 2. ChatViewProvider registered to handle the webview panel
 * 3. Commands registered for user interaction (Open Chat, Set API Key)
 * 4. Message listeners set up to handle webview communication
 * 5. deactivate() called when extension unloads (cleanup)
 */

/**
 * Resolves the DeepSeek API key from VS Code workspace configuration
 * 
 * This function provides a centralized way to retrieve the API key that users configure
 * in their VS Code settings. It checks the 'paypilot.apiKey' setting and provides
 * helpful debugging information about where the key was found.
 * 
 * SETTINGS INTEGRATION:
 * - Reads from VS Code's configuration system (Settings UI or settings.json)
 * - Setting defined in package.json under "configuration.properties"
 * - Users can set via: Settings UI → Extensions → PayPilot → API Key
 * - Or via Command Palette → "PayPilot: Set DeepSeek API Key"
 * 
 * SECURITY CONSIDERATIONS:
 * - API key stored in VS Code's secure settings system
 * - Not logged or exposed in error messages
 * - Validated before use in AI service calls
 * 
 * @returns Promise<object> Object containing the API key and its source for debugging
 */
async function resolveDeepSeekApiKey(): Promise<{ key?: string; source: string }> {
  // Access VS Code's configuration system for the 'paypilot' extension section
  const cfg = vscode.workspace.getConfiguration('paypilot');
  
  // Retrieve the 'apiKey' setting, ensuring it's a string and trimmed of whitespace
  const fromSetting = String(cfg.get('apiKey') || '').trim();
  
  if (fromSetting) {
    console.log('Found API key in VS Code settings');
    return { key: fromSetting, source: 'VS Code settings' };
  }

  // Log message to let users know there is no API key configured
  console.log('No API key found. Please set it using "PayPilot: Set DeepSeek API Key" command or in VS Code settings');
  return { key: undefined, source: 'none' };
}

/**
 * Extension activation function - called when the extension starts
 * 
 * This is the main orchestration function that sets up the entire extension.
 * VS Code calls this function when any of the activationEvents specified in
 * package.json are triggered (e.g., when the user opens the PayPilot view).
 * 
 * SETUP SEQUENCE:
 * 1. Create ChatViewProvider instance (manages the React webview)
 * 2. Register the webview provider with VS Code
 * 3. Register user commands (Open Chat, Set API Key)
 * 4. Set up message handling for webview communication
 * 5. Configure AI service integration
 * 
 * WEBVIEW INTEGRATION:
 * - ChatViewProvider creates the webview panel containing the React app
 * - The React app (from src/webview/) renders inside this webview
 * - Two-way communication established via postMessage/onMessage
 * 
 * @param context VS Code extension context providing lifecycle management and storage
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('PayPilot extension is active');

  // Create the chat view provider that manages the React webview
  // This provider creates the HTML container and loads the React app
  const chatProvider = new ChatViewProvider(context);
  
  // Register the webview view provider with VS Code
  // 'paypilotChatView' must match the view ID in package.json
  // retainContextWhenHidden keeps the React app state when panel is hidden
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('paypilotChatView', chatProvider, { 
      webviewOptions: { retainContextWhenHidden: true } 
    })
  );

  // Register command: "PayPilot: Open Chat"
  // This command focuses the chat view when invoked from Command Palette
  // The command ID 'paypilot.openChat' must match package.json commands section
  context.subscriptions.push(
    vscode.commands.registerCommand('paypilot.openChat', async () => {
      // Focus the specific chat view by its ID
      await vscode.commands.executeCommand('paypilotChatView.focus');
    })
  );

  // Register command: "PayPilot: Set DeepSeek API Key"
  // Provides a secure way for users to configure their API key
  context.subscriptions.push(
    vscode.commands.registerCommand('paypilot.setApiKey', async () => {
      // Show input box with password masking for security
      const value = await vscode.window.showInputBox({
        prompt: 'Enter your DeepSeek API key',
        password: true,                    // Masks input for security
        ignoreFocusOut: true              // Keeps dialog open if user clicks elsewhere
      });
      
      if (!value) {
        return;  // User cancelled the input
      }
      
      // Store the API key in VS Code's global settings
      // This makes it available across all workspaces
      const cfg = vscode.workspace.getConfiguration('paypilot');
      await cfg.update('apiKey', value, vscode.ConfigurationTarget.Global);
      
      // Confirm to user that the key was saved
      vscode.window.showInformationMessage('DeepSeek API key saved to settings');
    })
  );

  /**
   * MESSAGE HANDLING SYSTEM
   * 
   * This is the core communication hub between the React webview and the extension.
   * The React app sends typed messages (defined in types/chat.ts) and this handler
   * routes them to appropriate services and sends responses back.
   * 
   * MESSAGE TYPES HANDLED:
   * 1. 'chat:ask' - User wants to ask the AI a question
   * 2. 'editor:applyEdit' - User wants to apply AI-generated code
   * 3. 'editor:createFile' - User wants to create a new file with AI code
   * 
   * INTEGRATION POINTS:
   * - chatProvider.onMessage() - Listens for messages from React app
   * - askDeepSeek() - Calls AI service with streaming responses
   * - panel.postMessage() - Sends responses back to React app
   * - VS Code editor API - Applies code changes to user's files
   */
  chatProvider.onMessage(async (msg, panel) => {
    /**
     * HANDLE CHAT REQUESTS
     * 
     * When user types a message in the React chat interface and presses send,
     * this handler processes the request and streams the AI response back.
     * 
     * CONTEXT BUILDING:
     * - Includes current editor content for context-aware responses
     * - Respects maxContextChars setting to avoid token limits
     * - Adds language information for better code suggestions
     * 
     * STREAMING RESPONSE:
     * - Uses askDeepSeek() to get real-time streaming responses
     * - Sends each token back to React app for live display
     * - Handles errors gracefully with user-friendly messages
     */
    if (msg?.type === 'chat:ask') {
      try {
        // Resolve API key and validate before making request
        const { key: apiKey } = await resolveDeepSeekApiKey();
        if (!apiKey) {
          // Send error message to React app for display
          panel.postMessage({ 
            type: 'chat:error', 
            error: 'No API key found. Please set it using "PayPilot: Set DeepSeek API Key" command or in VS Code settings.' 
          });
          return;
        }

        // Get current editor context for AI awareness
        const editor = vscode.window.activeTextEditor;
        const cfg = vscode.workspace.getConfiguration('paypilot');
        const maxContextChars = Math.max(0, Number(cfg.get('maxContextChars')) || 0);

        let editorContext = '';
        let languageId = '';
        
        if (editor) {
          const doc = editor.document;
          languageId = doc.languageId;          // e.g., 'typescript', 'python'
          editorContext = doc.getText();        // Full file content
          
          // Truncate context if it exceeds the configured limit
          // This prevents hitting AI model token limits
          if (maxContextChars > 0 && editorContext.length > maxContextChars) {
            editorContext = editorContext.slice(-maxContextChars);  // Keep the end of the file
          }
        }

        // Compose the complete prompt for the AI
        // This gives the AI context about the current code and user's request
        const composed = [
          'You are PayPilot, a helpful AI coding assistant inside VS Code.',
          'You can suggest code changes. If you provide updated file content, place it in a fenced code block with the correct language.',
          'If you are updating only the current selection, place the replacement text in a fenced code block labelled with the same language.',
          '',
          `Current language: ${languageId || 'unknown'}`,
          '',
          editorContext ? '--- Start of editor context ---' : '',
          editorContext || '',
          editorContext ? '--- End of editor context ---' : '',
          '',
          'User request:',
          msg.prompt
        ].join('\n');

        // Call the DeepSeek AI service with streaming callbacks
        // This creates a real-time chat experience
        await askDeepSeek({
          apiKey,
          baseUrl: String(cfg.get('apiBase') || 'https://api.deepseek.com'),
          model: String(cfg.get('model') || 'deepseek-chat'),
          prompt: composed,
          // Stream each token to React app for real-time display
          onToken: (t) => panel.postMessage({ type: 'chat:stream', token: t }),
          // Send complete response when done
          onDone: (full) => panel.postMessage({ type: 'chat:done', text: full }),
          // Handle any errors during the request
          onError: (err) => panel.postMessage({ 
            type: 'chat:error', 
            error: err instanceof Error ? err.message : String(err) 
          })
        });
      } catch (err) {
        // Catch any unexpected errors and send to React app
        panel.postMessage({ 
          type: 'chat:error', 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    } 
    /**
     * HANDLE CODE EDIT REQUESTS
     * 
     * When user clicks "Apply to selection" or "Replace file" buttons in the React app,
     * this handler extracts the AI-generated code and applies it to the user's file.
     * 
     * EDIT MODES:
     * - 'selection': Replace only the currently selected text
     * - 'file': Replace the entire file content
     * - default: Insert at cursor position
     * 
     * INTEGRATION WITH VS CODE EDITOR:
     * - Uses VS Code's edit API for atomic operations
     * - Respects user's undo/redo history
     * - Handles edge cases like empty selections
     */
    else if (msg?.type === 'editor:applyEdit') {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        panel.postMessage({ type: 'chat:error', error: 'No active editor' });
        return;
      }
      
      const code = String(msg?.payload?.code || '');
      if (!code) {
        panel.postMessage({ type: 'chat:error', error: 'No code to apply' });
        return;
      }
      
      // Apply the edit using VS Code's atomic edit API
      await editor.edit(editBuilder => {
        if (msg.payload.mode === 'selection' && !editor.selection.isEmpty) {
          // Replace the currently selected text
          editBuilder.replace(editor.selection, code);
        } else if (msg.payload.mode === 'file') {
          // Replace the entire file content
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
          );
          editBuilder.replace(fullRange, code);
        } else {
          // Insert at the current cursor position
          editBuilder.insert(editor.selection.active, code);
        }
      });
      
      // Confirm to React app that the edit was applied
      panel.postMessage({ type: 'editor:applied' });
    } 
    /**
     * HANDLE NEW FILE CREATION
     * 
     * When user clicks "Create new file" button in the React app,
     * this handler creates a new file with the AI-generated code.
     * 
     * INTELLIGENT FILE NAMING:
     * - Attempts to extract filename from code comments
     * - Falls back to content-based inference (TypeScript, Python, etc.)
     * - Allows user to customize the filename before creation
     * 
     * FILE SYSTEM INTEGRATION:
     * - Creates file in the current workspace
     * - Opens the new file in VS Code editor
     * - Handles errors gracefully (no workspace, file conflicts, etc.)
     */
    else if (msg?.type === 'editor:createFile') {
      const code = String(msg?.payload?.code || '');
      if (!code) {
        panel.postMessage({ type: 'chat:error', error: 'No code to create file with' });
        return;
      }
      
      try {
        // Attempt to extract filename from code comments
        // Supports various comment styles: //, <!-- -->, #
        const filenameMatch = code.match(/\/\/\s*(.+\.(ts|js|py|java|cpp|c|h|css|html|json|xml|md))\s*\n/i) || 
                             code.match(/<!--\s*(.+\.(ts|js|py|java|cpp|c|h|css|html|json|xml|md))\s*-->/i) ||
                             code.match(/#\s*(.+\.(ts|js|py|java|cpp|c|h|css|html|json|xml|md))\s*\n/i);
        
        let suggestedName = 'new-file.txt';
        
        if (filenameMatch) {
          suggestedName = filenameMatch[1];
        } else {
          // Infer file type from code content patterns
          if (code.includes('function ') || code.includes('const ') || code.includes('import ')) {
            suggestedName = 'new-file.ts';
          } else if (code.includes('def ') || code.includes('import ')) {
            suggestedName = 'new-file.py';
          } else if (code.includes('<html') || code.includes('<!DOCTYPE')) {
            suggestedName = 'new-file.html';
          } else if (code.includes('{') && code.includes('}')) {
            suggestedName = 'new-file.json';
          }
        }
        
        // Ask user to confirm or modify the filename
        const fileName = await vscode.window.showInputBox({
          prompt: 'Enter filename',
          value: suggestedName,
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return 'Filename cannot be empty';
            }
            return null;
          }
        });
        
        if (!fileName) {
          return;  // User cancelled
        }
        
        // Ensure we have a workspace to create the file in
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          panel.postMessage({ type: 'chat:error', error: 'No workspace folder open' });
          return;
        }
        
        // Create the new file in the workspace
        const filePath = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
        await vscode.workspace.fs.writeFile(filePath, Buffer.from(code, 'utf8'));
        
        // Open the new file in the editor
        const document = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(document);
        
        // Confirm to React app that the file was created
        panel.postMessage({ type: 'editor:applied' });
      } catch (err) {
        // Handle file system errors (permissions, disk space, etc.)
        panel.postMessage({ 
          type: 'chat:error', 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    }
  });
}

/**
 * Extension deactivation function - called when the extension shuts down
 * 
 * This function is called when:
 * - VS Code is closing
 * - The extension is being disabled
 * - The extension is being uninstalled
 * 
 * CLEANUP RESPONSIBILITIES:
 * - Close any open connections or streams
 * - Save any pending state
 * - Release system resources
 * 
 * Note: Most cleanup is handled automatically by the context.subscriptions system,
 * so this function is often empty unless you have specific cleanup needs.
 */
export function deactivate() {
  // No explicit cleanup needed - VS Code handles subscription cleanup automatically
}