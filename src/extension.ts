import * as vscode from 'vscode';
import { ChatViewProvider } from './panels/ChatViewProvider';
import { askDeepSeek, resolveApiKey } from './services/deepseek';
import { ApiKeyManager } from './services/apiKeyManager';

// Global state for VS Code native diff management
let originalContent: string = ''; // Content before AI modifications
let currentDocumentUri: vscode.Uri | undefined; // File being tracked for diffs
let sourceControl: vscode.SourceControl | undefined; // VS Code source control integration
let originalContentProvider: OriginalContentProvider | undefined; // Custom URI content provider
let quickDiffProvider: PayPilotQuickDiffProvider | undefined; // Gutter diff indicators provider

// Status bar items management
let diffButton: vscode.StatusBarItem | undefined; // "View Diff" button
let acceptButton: vscode.StatusBarItem | undefined; // "Accept Changes" button
let rejectButton: vscode.StatusBarItem | undefined; // "Reject Changes" button

// AI generation cancellation
let currentAbortController: AbortController | null = null; // For cancelling ongoing AI requests

// Diff view management
let diffViewColumn: vscode.ViewColumn | undefined; // Track if diff view is open

/**
 * Content provider for original (pre-modification) content (read-only)
 * This provides the "left" side of the diff using a custom URI scheme
 */
class OriginalContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    console.log('[PayPilot] Content provider called for URI:', uri.toString());
    
    // Extract the original file path from our custom scheme
    const originalPath = uri.path;
    
    // Check if this matches our tracked document
    if (currentDocumentUri && originalPath === currentDocumentUri.path) {
      console.log('[PayPilot] Returning original content for:', originalPath);
      return originalContent; // Return saved pre-modification content
    }
    
    console.log('[PayPilot] No content found for:', originalPath);
    return ''; // No content available for this URI
  }

  update(uri: vscode.Uri) {
    console.log('[PayPilot] Firing content change event for:', uri.toString());
    this._onDidChange.fire(uri); // Notify VS Code to refresh diff
  }

  dispose() {
    this._onDidChange.dispose(); // Clean up event emitter
  }
}

/**
 * Quick Diff Provider for inline diff indicators
 * This shows the green/red line indicators in the editor gutter
 */
class PayPilotQuickDiffProvider implements vscode.QuickDiffProvider {
  provideOriginalResource(uri: vscode.Uri, token?: vscode.CancellationToken): vscode.Uri | undefined {
    console.log('[PayPilot] QuickDiffProvider called for URI:', uri.toString());
    
    if (token?.isCancellationRequested) {
      return undefined; // Operation was cancelled
    }
    
    // Check if this is the document we're tracking
    if (currentDocumentUri && uri.toString() === currentDocumentUri.toString()) {
      // Map file URI to our custom scheme for original content
      const originalUri = vscode.Uri.parse(`paypilot-original:${uri.path}`);
      console.log('[PayPilot] Returning original URI:', originalUri.toString());
      return originalUri;
    }
    
    console.log('[PayPilot] No original resource for:', uri.toString());
    return undefined; // Not tracking this file
  }

  dispose() {
    // No cleanup needed for this provider
  }
}

/**
 * Apply changes using VS Code's native diff functionality
 */
async function applyChangesWithVSCodeDiff(newContent: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return; // No active editor to apply changes to
  }

  // Clean up any existing diff state first (for multiple consecutive edits)
  cleanupStatusBarItems();

  // Store current state for diff comparison
  originalContent = editor.document.getText(); // Save content before changes
  currentDocumentUri = editor.document.uri; // Track which file we're diffing

  // Setup content provider for original content if not already registered
  if (!originalContentProvider) {
    originalContentProvider = new OriginalContentProvider();
    // Register custom URI scheme handler for paypilot-original:
    vscode.workspace.registerTextDocumentContentProvider('paypilot-original', originalContentProvider);
  }

  // Apply the new content to the editor
  await editor.edit(editBuilder => {
    // Replace entire document content
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    editBuilder.replace(fullRange, newContent);
  });

  // Create source control for Quick Diff with proper workspace root
  if (!sourceControl) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const rootUri = workspaceFolder?.uri || vscode.workspace.workspaceFolders?.[0]?.uri;
    
    console.log('[PayPilot] Creating source control with root URI:', rootUri?.toString());
    sourceControl = vscode.scm.createSourceControl('paypilot', 'PayPilot', rootUri);
    
    // Create and assign quick diff provider for gutter indicators
    if (!quickDiffProvider) {
      quickDiffProvider = new PayPilotQuickDiffProvider();
    }
    sourceControl.quickDiffProvider = quickDiffProvider; // Enable diff indicators
    
    console.log('[PayPilot] Source control created successfully');
  }

  // Update the content provider to refresh diff indicators
  const originalUri = vscode.Uri.parse(`paypilot-original:${currentDocumentUri.path}`);
  console.log('[PayPilot] Updating content provider for URI:', originalUri.toString());
  originalContentProvider.update(originalUri); // Trigger diff refresh

  // Force a refresh of the quick diff after a short delay
  setTimeout(() => {
    if (originalContentProvider && currentDocumentUri) {
      const refreshUri = vscode.Uri.parse(`paypilot-original:${currentDocumentUri.path}`);
      console.log('[PayPilot] Forcing refresh for quick diff:', refreshUri.toString());
      originalContentProvider.update(refreshUri); // Second refresh to ensure diff shows
    }
  }, 100);

  // Show action buttons
  showDiffActionButtons();

  // Store cleanup function reference for global access
  (global as any).paypilotCleanup = cleanupDiffResources;

  // Auto-cleanup on editor change
  const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((newEditor) => {
    const currentFile = vscode.window.activeTextEditor?.document.uri.toString();
    const originalFile = newEditor?.document.uri.toString();
    
    // Clean up when user switches to a different file
    if (currentFile && originalFile && currentFile !== originalFile) {
      cleanupDiffResources();
      editorChangeDisposable.dispose(); // Remove this listener
    }
  });
}

/**
 * Toggle side-by-side diff view using VS Code's native diff editor
 */
async function openSideBySideDiff() {
  if (!currentDocumentUri || !originalContent) {
    vscode.window.showErrorMessage('No changes to diff');
    return; // No diff state available
  }

  // Check if diff is already open by trying to close it first
  if (diffViewColumn !== undefined) {
    // Close the diff view by focusing on it and closing the tab
    try {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      diffViewColumn = undefined;
      
      // Update button text to indicate it will open diff
      if (diffButton) {
        diffButton.text = "$(diff) View Diff";
        diffButton.tooltip = 'View side-by-side diff of PayPilot changes';
      }
      
      console.log('[PayPilot] Diff view closed');
      return;
    } catch (error) {
      console.log('[PayPilot] Could not close diff view, proceeding to open new one');
      diffViewColumn = undefined;
    }
  }

  console.log('[PayPilot] Opening side-by-side diff');

  // Create URIs for original and modified content using simplified scheme
  const originalUri = vscode.Uri.parse(`paypilot-original:${currentDocumentUri.path}`);
  
  console.log('[PayPilot] Original URI:', originalUri.toString());
  console.log('[PayPilot] Modified URI:', currentDocumentUri.toString());
  
  try {
    // Open diff editor using VS Code's built-in diff command
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri, // Left side: original content
      currentDocumentUri, // Right side: current content
      'PayPilot Changes (Original ↔ Modified)', // Diff tab title
      { viewColumn: vscode.ViewColumn.Beside } // Open in new column
    );
    
    // Track that diff is now open
    diffViewColumn = vscode.ViewColumn.Beside;
    
    // Update button text to indicate it will close diff
    if (diffButton) {
      diffButton.text = "$(x) Close Diff";
      diffButton.tooltip = 'Close diff view';
    }
    
    console.log('[PayPilot] Diff editor opened successfully');
  } catch (error) {
    console.error('[PayPilot] Error opening diff editor:', error);
    vscode.window.showErrorMessage(`Failed to open diff view: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Show action buttons in status bar
 */
function showDiffActionButtons() {
  // Clean up any existing buttons first
  cleanupStatusBarItems(); // Prevent duplicate buttons

  // Create status bar items
  diffButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2001);
  diffButton.text = "$(diff) View Diff";
  diffButton.command = 'paypilot.openDiff'; // Command to open side-by-side diff
  diffButton.tooltip = 'Open side-by-side diff view';
  diffButton.show();

  acceptButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2000);
  acceptButton.text = "$(check) Accept Changes";
  acceptButton.command = 'paypilot.acceptChanges'; // Command to keep changes
  acceptButton.tooltip = 'Accept all PayPilot changes';
  acceptButton.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
  acceptButton.show();

  rejectButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1999);
  rejectButton.text = "$(discard) Reject Changes";
  rejectButton.command = 'paypilot.rejectChanges'; // Command to revert changes
  rejectButton.tooltip = 'Reject all PayPilot changes';
  rejectButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  rejectButton.show();

  console.log('[PayPilot] Status bar buttons created and shown');
}

/**
 * Clean up status bar items
 */
function cleanupStatusBarItems() {
  if (diffButton) {
    diffButton.dispose(); // Remove "View Diff" button
    diffButton = undefined;
  }
  if (acceptButton) {
    acceptButton.dispose(); // Remove "Accept Changes" button
    acceptButton = undefined;
  }
  if (rejectButton) {
    rejectButton.dispose(); // Remove "Reject Changes" button
    rejectButton = undefined;
  }
  
  // Reset diff view tracking
  diffViewColumn = undefined;
  
  console.log('[PayPilot] Status bar items cleaned up');
}

/**
 * Clean up all diff-related resources
 */
function cleanupDiffResources() {
  console.log('[PayPilot] Cleaning up all diff resources');
  
  // Clean up status bar items
  cleanupStatusBarItems(); // Remove all diff buttons
  
  // Clean up source control
  if (sourceControl) {
    sourceControl.dispose(); // Remove from SCM panel
    sourceControl = undefined;
  }
  
  // Clean up providers
  if (quickDiffProvider) {
    quickDiffProvider.dispose(); // Clean up diff provider
    quickDiffProvider = undefined;
  }
  
  if (originalContentProvider) {
    originalContentProvider.dispose(); // Clean up content provider
    originalContentProvider = undefined;
  }
  
  // Reset state
  currentDocumentUri = undefined; // Clear tracked file
  originalContent = ''; // Clear saved content
  delete (global as any).paypilotCleanup; // Remove global cleanup reference
}

/**
 * Accept all changes (keep the modified content)
 */
async function acceptChanges() {
  cleanupDiffResources(); // Remove diff UI and keep current content
  vscode.window.showInformationMessage('Changes accepted successfully');
}

/**
 * Reject all changes (restore original content)
 */
async function rejectChanges() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !originalContent) return; // No editor or original content

  // Restore original content
  await editor.edit(editBuilder => {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    editBuilder.replace(fullRange, originalContent); // Revert to original
  });

  cleanupDiffResources(); // Remove diff UI after reverting
  vscode.window.showInformationMessage('Changes rejected successfully');
}

/**
 * Resolves API key from secure storage or VS Code configuration fallback
 */
async function resolveDeepSeekApiKey(context: vscode.ExtensionContext): Promise<{ key?: string; source: string }> {
  const apiKey = await resolveApiKey(context);
  
  if (apiKey) {
    // Check if it came from secure storage first
    const apiKeyManager = new ApiKeyManager(context);
    const secureApiKey = await apiKeyManager.getApiKey('deepseek');
    
    if (secureApiKey) {
      console.log('Found API key in secure storage');
      return { key: apiKey, source: 'Secure Storage' };
    } else {
      console.log('Found API key in VS Code settings');
      return { key: apiKey, source: 'VS Code settings' };
    }
  }

  console.log('No API key found. Please set it using "PayPilot: Set DeepSeek API Key" command');
  return { key: undefined, source: 'none' }; // No API key configured
}

/**
 * Extension activation function
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('PayPilot extension is active (VS Code API version)');

  // Initialize API key manager
  const apiKeyManager = new ApiKeyManager(context);
  
  // Register API key management commands
  ApiKeyManager.registerCommands(context, apiKeyManager);

  // Initialize chat view provider
  const chatProvider = new ChatViewProvider(context);
  
  // Register webview view provider for chat panel
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('paypilotChatView', chatProvider, { 
      webviewOptions: { retainContextWhenHidden: true } // Keep chat state when hidden
    })
  );

  // Register command to open chat view
  context.subscriptions.push(
    vscode.commands.registerCommand('paypilot.openChat', async () => {
      await vscode.commands.executeCommand('paypilotChatView.focus'); // Focus chat panel
    })
  );

  // Register diff-related commands
  context.subscriptions.push(
    vscode.commands.registerCommand('paypilot.openDiff', openSideBySideDiff) // Open diff view
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('paypilot.acceptChanges', acceptChanges) // Keep changes
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('paypilot.rejectChanges', rejectChanges) // Revert changes
  );

  /**
   * MESSAGE HANDLING SYSTEM - Processes chat messages and AI requests
   */
  chatProvider.onMessage(async (msg: any, panel: any) => {
    if (msg?.type === 'chat:ask') {
      try {
        // Resolve API key from configuration
        const { key: apiKey } = await resolveDeepSeekApiKey(context);
        if (!apiKey) {
          panel.postMessage({ 
            type: 'chat:error', 
            error: 'No API key found. Please set it using "PayPilot: Set DeepSeek API Key" command or in VS Code settings.' 
          });
          return; // Can't proceed without API key
        }

        const editor = vscode.window.activeTextEditor;
        const cfg = vscode.workspace.getConfiguration('paypilot');
        const maxContextChars = Math.max(0, Number(cfg.get('maxContextChars')) || 0);

        // Extract editor context for AI prompt
        let editorContext = '';
        if (editor && maxContextChars > 0) {
          const fullText = editor.document.getText();
          if (fullText.length <= maxContextChars) {
            editorContext = fullText; // Use entire file if small enough
          } else {
            const selection = editor.selection;
            if (!selection.isEmpty) {
              editorContext = editor.document.getText(selection); // Use selected text
            } else {
              // Use text around cursor position
              const cursorPosition = selection.active;
              const lineNumber = cursorPosition.line;
              const totalLines = editor.document.lineCount;
              
              const contextRadius = Math.floor(maxContextChars / 80); // Estimate lines from chars
              const startLine = Math.max(0, lineNumber - contextRadius);
              const endLine = Math.min(totalLines - 1, lineNumber + contextRadius);
              
              const contextRange = new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length);
              editorContext = editor.document.getText(contextRange);
            }
          }
        }

        const mode = msg.mode || 'ask'; // Default to 'ask' mode
        
        // Show thinking indicator to user
        panel.postMessage({
          type: 'chat:thinking',
          message: mode === 'agent' ? 'Analyzing code and preparing changes...' : 'Thinking...'
        });

        // Compose the prompt based on mode (agent vs ask)
        let composed = '';
        if (mode === 'agent') {
          // Agent mode: Request code modifications
          composed = [
            'You are an AI coding assistant. Analyze the user\'s request and the provided code context.',
            'Your task is to make the requested changes to the code.',
            'Always respond with the complete modified file content wrapped in a code block.',
            'Do not include explanations outside the code block.',
            '',
            editorContext ? '--- Current file context ---' : '',
            editorContext || '',
            editorContext ? '--- End of context ---' : '',
            '',
            'User request:',
            msg.prompt
          ].join('\n');
        } else {
          // Ask mode: Answer questions and provide help
          composed = [
            'You are an AI assistant helping with coding questions.',
            'If you provide code, wrap it in code blocks with appropriate language identifiers.',
            '',
            editorContext ? '--- Current file context ---' : '',
            editorContext || '',
            editorContext ? '--- End of context ---' : '',
            '',
            'User question:',
            msg.prompt
          ].join('\n');
        }

        let fullResponse = ''; // Accumulate streaming response

        // Store the current request for potential cancellation
        const abortController = new AbortController();
        currentAbortController = abortController;

        // Make API call to DeepSeek
        await askDeepSeek({
          apiKey,
          baseUrl: String(cfg.get('apiBase') || 'https://api.deepseek.com'), // API endpoint
          model: String(cfg.get('model') || 'deepseek-chat'), // AI model
          prompt: composed,
          abortSignal: abortController.signal,
          onToken: (t) => {
            fullResponse += t; // Build complete response
            panel.postMessage({ type: 'chat:stream', token: t }); // Stream to UI
          },
          onDone: async (full) => {
            currentAbortController = null; // Clear the controller
            panel.postMessage({ type: 'chat:done', text: full }); // Notify UI completion
            
            // If in agent mode and we have code, apply it using VS Code's native diff
            if (mode === 'agent' && editor) {
              // Extract code from markdown code blocks
              const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/;
              const match = full.match(codeBlockRegex);
              
              if (match && match[1]) {
                const newContent = match[1].trim();
                await applyChangesWithVSCodeDiff(newContent); // Apply changes and show diff
              }
            }
          },
          onError: (err) => {
            currentAbortController = null; // Clear the controller
            panel.postMessage({ 
              type: 'chat:error', 
              error: err instanceof Error ? err.message : String(err) // Send error to UI
            });
          }
        });

      } catch (error) {
        currentAbortController = null; // Clear the controller on any error
        console.error('Error in chat:ask handler:', error);
        panel.postMessage({
          type: 'chat:error',
          error: error instanceof Error ? error.message : 'An unknown error occurred'
        });
      }
    } else if (msg?.type === 'chat:stop') {
      // Handle stop generation request
      if (currentAbortController) {
        currentAbortController.abort(); // Cancel the current request
        currentAbortController = null;
        panel.postMessage({ type: 'chat:stopped' }); // Notify UI that generation was stopped
      }
    } // End of message handling
  });
}

export function deactivate() {
  cleanupDiffResources(); // Clean up all extension resources on deactivation
}
