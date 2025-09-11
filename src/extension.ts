import * as vscode from "vscode";
import { ChatViewProvider } from "./panels/ChatViewProvider";
import {
  getAvailableModels,
  streamChatAgent,
  streamChatUI,
} from "./services/languageModel";

// Global state for VS Code native diff management
let originalContent: string = ""; // Content before AI modifications
let currentDocumentUri: vscode.Uri | undefined; // File being tracked for diffs
let sourceControl: vscode.SourceControl | undefined; // VS Code source control integration
let originalContentProvider: OriginalContentProvider | undefined; // Custom URI content provider
let quickDiffProvider: PayPilotQuickDiffProvider | undefined; // Gutter diff indicators provider
let chatPanelVisible: boolean = false; // Track chat panel visibility

// Status bar items management
let diffButton: vscode.StatusBarItem | undefined; // "View Diff" button
let acceptButton: vscode.StatusBarItem | undefined; // "Accept Changes" button
let rejectButton: vscode.StatusBarItem | undefined; // "Reject Changes" button

// Diff view state management
let isDiffViewOpen: boolean = false; // Track diff view state
let savedEditorLayout: any = undefined; // Store editor layout before diff
let diffViewDisposables: vscode.Disposable[] = []; // Track diff view event listeners

// AI generation cancellation
let currentAbortController: AbortController | null = null; // For cancelling ongoing AI requests

// MCP state management
let enableMcp: boolean = false; // Track MCP enabled state
let activeServers: string[] = []; // Track selected MCP servers

// Diff view management
let diffViewColumn: vscode.ViewColumn | undefined; // Track if diff view is open

/**
 * TextDocumentContentProvider interface implementation
 * This provides the "left" side of the diff using a custom URI scheme
 */
class OriginalContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    console.log("[PayPilot] Content provider called for URI:", uri.toString());

    // Extract the original file path from our custom scheme
    const originalPath = uri.path;

    // Check if this matches our tracked document
    if (currentDocumentUri && originalPath === currentDocumentUri.path) {
      console.log("[PayPilot] Returning original content for:", originalPath);
      return originalContent; // Return saved pre-modification content
    }

    console.log("[PayPilot] No content found for:", originalPath);
    return ""; // No content available for this URI
  }

  update(uri: vscode.Uri) {
    console.log("[PayPilot] Firing content change event for:", uri.toString());
    this._onDidChange.fire(uri); // Notify VS Code to refresh diff
  }

  dispose() {
    this._onDidChange.dispose(); // Clean up event emitter
  }
}

/**
 * QuickDiffProvider interface implementation
 * This shows the green/red line indicators in the editor gutter
 */
class PayPilotQuickDiffProvider implements vscode.QuickDiffProvider {
  provideOriginalResource(
    uri: vscode.Uri,
    token?: vscode.CancellationToken
  ): vscode.Uri | undefined {
    console.log("[PayPilot] QuickDiffProvider called for URI:", uri.toString());

    if (token?.isCancellationRequested) {
      return undefined; // Operation was cancelled
    }

    // Check if this is the document we're tracking
    if (
      currentDocumentUri &&
      uri.toString() === currentDocumentUri.toString()
    ) {
      // Map file URI to our custom scheme for original content
      const originalUri = vscode.Uri.parse(`paypilot-original:${uri.path}`);
      console.log("[PayPilot] Returning original URI:", originalUri.toString());
      return originalUri;
    }

    console.log("[PayPilot] No original resource for:", uri.toString());
    return undefined; // Not tracking this file
  }

  dispose() {
    // No cleanup needed for this provider
  }
}

/**
 * Calculate proper diff statistics between two arrays of lines
 * Uses LCS-based approach for more accurate diff counting
 * @param oldLines Lines from original content
 * @param newLines Lines from modified content
 * @returns Object containing added and deleted line counts
 */
function calculateDiffStats(
  oldLines: string[],
  newLines: string[]
): { added: number; deleted: number } {
  const m = oldLines.length;
  const n = newLines.length;

  // Create LCS table
  const lcs: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Build LCS table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Calculate actual additions and deletions
  const commonLines = lcs[m][n];
  const added = n - commonLines;
  const deleted = m - commonLines;

  return { added, deleted };
}

/**
 * Apply changes using VS Code's native diff functionality
 * This function creates a temporary file with the original content and overwrites the active editor's content with the new content.
 * @param newContent The modified content to apply
 */
async function applyChangesWithVSCodeDiff(newContent: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return; // No active editor to apply changes to
  }

  // Clean up any existing diff state first (for multiple consecutive edits)
  // Note: Only cleanup status bar items, preserve diff view state if open
  const wasDiffViewOpen = isDiffViewOpen;
  cleanupStatusBarItems();

  // If diff was open, we'll need to update it with new content later
  if (wasDiffViewOpen) {
    console.log("[PayPilot] Diff view was open, will preserve and update it");
  } else {
    console.log("[PayPilot] Applying changes with no diff view currently open");
  }

  // Store current state for diff comparison
  originalContent = editor.document.getText(); // Save content before changes
  currentDocumentUri = editor.document.uri; // Track which file we're diffing

  // Setup content provider for original content if not already registered
  if (!originalContentProvider) {
    originalContentProvider = new OriginalContentProvider();
    // Register custom URI scheme handler for paypilot-original:
    vscode.workspace.registerTextDocumentContentProvider(
      "paypilot-original",
      originalContentProvider
    );
  }

  // Apply the new content to the editor
  await editor.edit((editBuilder) => {
    // Replace entire document content
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    editBuilder.replace(fullRange, newContent);
  });

  // Create source control for Quick Diff with proper workspace root
  if (!sourceControl) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      editor.document.uri
    );
    const rootUri =
      workspaceFolder?.uri || vscode.workspace.workspaceFolders?.[0]?.uri;

    console.log(
      "[PayPilot] Creating source control with root URI:",
      rootUri?.toString()
    );
    sourceControl = vscode.scm.createSourceControl(
      "paypilot",
      "PayPilot",
      rootUri
    );

    // Create and assign quick diff provider for gutter indicators
    if (!quickDiffProvider) {
      quickDiffProvider = new PayPilotQuickDiffProvider();
    }
    sourceControl.quickDiffProvider = quickDiffProvider; // Enable diff indicators

    console.log("[PayPilot] Source control created successfully");
  }

  // Update the content provider to refresh diff indicators
  const originalUri = vscode.Uri.parse(
    `paypilot-original:${currentDocumentUri.path}`
  );
  console.log(
    "[PayPilot] Updating content provider for URI:",
    originalUri.toString()
  );
  originalContentProvider.update(originalUri); // Trigger diff refresh

  // Force a refresh of the quick diff after a short delay
  setTimeout(() => {
    if (originalContentProvider && currentDocumentUri) {
      const refreshUri = vscode.Uri.parse(
        `paypilot-original:${currentDocumentUri.path}`
      );
      console.log(
        "[PayPilot] Forcing refresh for quick diff:",
        refreshUri.toString()
      );
      originalContentProvider.update(refreshUri); // Second refresh to ensure diff shows
    }
  }, 100);

  // Show action buttons (this will now properly restore the diff button state)
  showDiffActionButtons();
  
  // If diff view was open, update it with the new content
  if (wasDiffViewOpen) {
    console.log("[PayPilot] Diff view state preserved - button should show 'Close Diff'");
    // The diff view will automatically update since we're using the same file URI
    // and the content provider will show the new original content
  } else {
    console.log("[PayPilot] No diff view was open - button should show 'View Diff'");
  }

  // Store cleanup function reference for global access
  (global as any).paypilotCleanup = cleanupDiffResources;

  // Auto-cleanup on editor change
  const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(
    (newEditor) => {
      const currentFile =
        vscode.window.activeTextEditor?.document.uri.toString();
      const originalFile = newEditor?.document.uri.toString();

      // Clean up when user switches to a different file
      if (currentFile && originalFile && currentFile !== originalFile) {
        cleanupDiffResources();
        editorChangeDisposable.dispose(); // Remove this listener
      }
    }
  );
}

/**
 * Save current editor layout state before opening diff
 */
async function saveEditorLayout() {
  console.log("[PayPilot] Saving current editor layout for restoration later");
  
  // Get list of currently open tabs
  const tabGroups = vscode.window.tabGroups.all;
  savedEditorLayout = {
    activeTab: vscode.window.activeTextEditor?.document.uri.toString(),
    tabGroups: tabGroups.map(group => ({
      tabs: group.tabs.map(tab => ({
        input: tab.input,
        isActive: tab.isActive,
        isPinned: tab.isPinned
      })),
      isActive: group.isActive
    }))
  };
  
  console.log(`[PayPilot] ✅ Saved editor layout with ${tabGroups.length} tab groups`);
}

/**
 * Restore previously saved editor layout
 */
async function restoreEditorLayout() {
  if (!savedEditorLayout) {
    console.log("[PayPilot] ⚠️ No saved layout to restore");
    return;
  }
  
  console.log("[PayPilot] 🔄 Restoring previous editor layout");
  
  try {
    // Close all tabs first
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    
    // Reopen the original file if it was active
    if (savedEditorLayout.activeTab && currentDocumentUri) {
      await vscode.window.showTextDocument(currentDocumentUri, {
        viewColumn: vscode.ViewColumn.One,
        preview: false
      });
    }
    
    console.log("[PayPilot] ✅ Editor layout restored successfully");
  } catch (error) {
    console.error("[PayPilot] ❌ Error restoring editor layout:", error);
  }
  
  savedEditorLayout = undefined;
}

/**
 * Setup listeners for diff view state changes
 */
function setupDiffViewListeners() {
  // Clear any existing listeners
  diffViewDisposables.forEach((disposable) => disposable.dispose());
  diffViewDisposables = [];

  // Listen for tab close events
  const tabChangeDisposable = vscode.window.tabGroups.onDidChangeTabs(
    async (event) => {
    if (!isDiffViewOpen) {
      return;
    }
    
    // Check if any of the closed tabs was our diff view
    for (const tab of event.closed) {
      if (tab.label === "PayPilot Changes (Original ↔ Modified)") {
        console.log("[PayPilot] Diff view tab was closed by user");
        await handleDiffViewClosed();
        break;
      }
    }
    }
  );

  // Listen for active editor changes to detect diff view closure
  const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(
    async (editor) => {
    if (!isDiffViewOpen) {
      return;
    }
    
    // Check if we're no longer in a diff view
      if (
        editor &&
        !editor.document.uri.toString().includes("PayPilot Changes")
      ) {
      // Small delay to ensure the diff tab is actually closed
      setTimeout(async () => {
          const allTabs = vscode.window.tabGroups.all.flatMap(
            (group) => group.tabs
          );
          const diffTabExists = allTabs.some(
            (tab) => tab.label === "PayPilot Changes (Original ↔ Modified)"
        );
        
        if (!diffTabExists && isDiffViewOpen) {
            console.log(
              "[PayPilot] Diff view no longer exists, updating state"
            );
          await handleDiffViewClosed();
        }
      }, 100);
    }
    }
  );

  diffViewDisposables.push(tabChangeDisposable, editorChangeDisposable);
}

/**
 * Handle diff view being closed (either by user or programmatically)
 */
async function handleDiffViewClosed() {
  console.log("[PayPilot] Handling diff view closure - updating button state and restoring layout");
  
  isDiffViewOpen = false;
  diffViewColumn = undefined;
  
  // Update button state
  if (diffButton) {
    diffButton.text = "$(diff) View Diff";
    diffButton.tooltip = "View side-by-side diff of PayPilot changes";
    console.log("[PayPilot] Updated 'Close Diff' button back to 'View Diff'");
  }
  
  // Restore previous layout
  await restoreEditorLayout();
  
  // Clean up listeners
  diffViewDisposables.forEach(disposable => disposable.dispose());
  diffViewDisposables = [];
  
  console.log("[PayPilot] ✅ Diff view cleanup completed");
}

/**
 * Toggle side-by-side diff view using VS Code's native diff editor
 * Enhanced version that hides other files and restores layout on close
 */
async function openSideBySideDiff() {
  if (!currentDocumentUri || !originalContent) {
    vscode.window.showErrorMessage("No changes to diff");
    return; // No diff state available
  }

  // If diff is already open, close it
  if (isDiffViewOpen) {
    console.log("[PayPilot] Closing existing diff view and restoring layout");
    await handleDiffViewClosed();
    return;
  }

  console.log("[PayPilot] Opening enhanced side-by-side diff (full-screen mode)");

  try {
    // Save current editor layout
    await saveEditorLayout();
    
    // Close all editors to provide clean diff view
    console.log("[PayPilot] Closing all open editors for clean diff view");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    
    // Create URIs for original and modified content
    const originalUri = vscode.Uri.parse(
      `paypilot-original:${currentDocumentUri.path}`
    );

    console.log("[PayPilot] Original URI:", originalUri.toString());
    console.log("[PayPilot] Modified URI:", currentDocumentUri.toString());

    // Open diff editor in main column (full screen)
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri, // Left side: original content
      currentDocumentUri, // Right side: current content
      "PayPilot Changes (Original ↔ Modified)", // Diff tab title
      { viewColumn: vscode.ViewColumn.One } // Open in main column
    );

    // Update state
    isDiffViewOpen = true;
    diffViewColumn = vscode.ViewColumn.One;
    
    // Setup listeners for detecting when diff is closed
    setupDiffViewListeners();

    // Update button text to indicate it will close diff
    if (diffButton) {
      diffButton.text = "$(x) Close Diff";
      diffButton.tooltip = "Close diff view and restore previous layout";
    }

    console.log("[PayPilot] Enhanced diff editor opened successfully in full-screen mode");
  } catch (error) {
    console.error("[PayPilot] Error opening diff editor:", error);
    vscode.window.showErrorMessage(
      `Failed to open diff view: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    
    // Restore layout if opening failed
    console.log("[PayPilot] Restoring layout due to diff opening failure");
    await restoreEditorLayout();
  }
}

/**
 * Show action buttons in status bar (only when chat panel is visible)
 */
function showDiffActionButtons() {
  // Only show buttons if chat panel is visible
  if (!chatPanelVisible) {
    return;
  }

  // Store current diff state before cleanup
  const wasDiffOpen = isDiffViewOpen;

  // Clean up any existing buttons first
  cleanupStatusBarItems(); // Prevent duplicate buttons

  // Restore diff state after cleanup (cleanupStatusBarItems resets isDiffViewOpen)
  isDiffViewOpen = wasDiffOpen;

  // Create status bar items
  diffButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    2001
  );
  
  // Set button text based on current diff state
  if (isDiffViewOpen) {
    diffButton.text = "$(x) Close Diff";
    diffButton.tooltip = "Close diff view and restore previous layout";
    console.log("[PayPilot] 🔄 Recreated button with 'Close Diff' state (diff was open)");
  } else {
    diffButton.text = "$(diff) View Diff";
    diffButton.tooltip = "Open side-by-side diff view";
    console.log("[PayPilot] 🔄 Recreated button with 'View Diff' state (diff was closed)");
  }
  
  diffButton.command = "paypilot.openDiff"; // Command to open side-by-side diff
  diffButton.show();

  acceptButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    2000
  );
  acceptButton.text = "$(check) Accept Changes";
  acceptButton.command = "paypilot.acceptChanges"; // Command to keep changes
  acceptButton.tooltip = "Accept all PayPilot changes";
  acceptButton.backgroundColor = new vscode.ThemeColor(
    "statusBarItem.prominentBackground"
  );
  acceptButton.show();

  rejectButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    1999
  );
  rejectButton.text = "$(discard) Reject Changes";
  rejectButton.command = "paypilot.rejectChanges"; // Command to revert changes
  rejectButton.tooltip = "Reject all PayPilot changes";
  rejectButton.backgroundColor = new vscode.ThemeColor(
    "statusBarItem.errorBackground"
  );
  rejectButton.show();

  console.log("[PayPilot] Status bar buttons created and shown");
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

  // Note: Don't reset isDiffViewOpen here as it might be called during button recreation
  diffViewColumn = undefined;

  console.log("[PayPilot] Status bar items cleaned up");
}

/**
 * Clean up all diff-related resources
 */
function cleanupDiffResources() {
  console.log("[PayPilot] Cleaning up all diff resources");

  // Clean up status bar items
  cleanupStatusBarItems(); // Remove all diff buttons

  // Clean up diff view listeners
  diffViewDisposables.forEach(disposable => disposable.dispose());
  diffViewDisposables = [];

  // Reset diff view state (this is where we properly reset the state)
  isDiffViewOpen = false;
  diffViewColumn = undefined;
  savedEditorLayout = undefined;

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
  originalContent = ""; // Clear saved content
  delete (global as any).paypilotCleanup; // Remove global cleanup reference
}

/**
 * Accept all changes (keep the modified content)
 */
async function acceptChanges() {
  console.log("[PayPilot] Accepting changes");
  
  // If diff view is open, close it gracefully and restore layout
  if (isDiffViewOpen) {
    console.log("[PayPilot] Closing diff view and restoring layout after accepting changes");
    await handleDiffViewClosed();
  }
  
  // Clean up all diff resources
  cleanupDiffResources();
  vscode.window.showInformationMessage("Changes accepted successfully");
}

/**
 * Reject all changes (restore original content)
 */
async function rejectChanges() {
  console.log("[PayPilot] Rejecting changes");
  
  const editor = vscode.window.activeTextEditor;
  if (!editor || !originalContent) {
    return; // No editor or original content
  }

  // Restore original content
  await editor.edit((editBuilder) => {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    editBuilder.replace(fullRange, originalContent); // Revert to original
  });

  // If diff view is open, close it gracefully and restore layout
  if (isDiffViewOpen) {
    console.log("[PayPilot] Closing diff view and restoring layout after rejecting changes");
    await handleDiffViewClosed();
  }

  // Clean up all diff resources
  cleanupDiffResources();
  vscode.window.showInformationMessage("Changes rejected successfully");
}

/**
 * Ensures the context7 MCP server is configured in VS Code settings
 */
async function ensureContext7McpServer() {
  try {
    const config = vscode.workspace.getConfiguration('mcp');
    const servers = config.get('servers', {}) as Record<string, any>;
    
    // Check if context7 server already exists
    if (!servers['context7']) {
      console.log('[PayPilot] Adding context7 MCP server to configuration');
      
      const context7Server = {
        type: 'http',
        url: 'https://mcp.context7.com/mcp'
      };
      
      servers['context7'] = context7Server;
      
      // Update the configuration globally
      await config.update('servers', servers, vscode.ConfigurationTarget.Global);
      console.log('[PayPilot] context7 MCP server added successfully');
    } else {
      console.log('[PayPilot] context7 MCP server already configured');
    }
  } catch (error) {
    console.error('[PayPilot] Error configuring context7 MCP server:', error);
  }
}

/**
 * Gets available MCP servers from VS Code configuration
 */
function getMcpServers(): any[] {
  try {
    const config = vscode.workspace.getConfiguration('mcp');
    const servers = config.get('servers', {}) as Record<string, any>;
    
    return Object.keys(servers).map(name => ({
      name,
      ...servers[name]
    }));
  } catch (error) {
    console.error('[PayPilot] Error reading MCP servers:', error);
    return [];
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("PayPilot extension is active (VS Code Language Model API)");

  // Initialize chat view provider
  const chatProvider = new ChatViewProvider(context);

  // Auto-inject context7 MCP server if not already present
  await ensureContext7McpServer();

  // Register webview view provider for chat panel into extension context
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "paypilotChatView",
      chatProvider,
      {
        webviewOptions: { retainContextWhenHidden: true }, // Keep chat state when hidden
      }
    )
  );

  // Track chat panel visibility
  chatProvider.onVisibilityChange((visible) => {
    chatPanelVisible = visible;
    if (!visible) {
      // Clean up PayPilot buttons when panel is hidden
      cleanupStatusBarItems();
    } else {
      // Show buttons if there are existing changes when panel is reopened
      if (currentDocumentUri && originalContent) {
        showDiffActionButtons();
      }
    }
  });

  // Auto-load models when extension starts to enable immediate use
  chatProvider.postMessage({ type: "model:list-request" });

  // Listen for VS Code language model changes and refresh webview
  if (vscode.lm && vscode.lm.onDidChangeChatModels) {
    context.subscriptions.push(
      vscode.lm.onDidChangeChatModels(() => {
        // Notify webview about model changes
        chatProvider.postMessage({ type: "model:list-request" });
      })
    );
  }

  // Register command to open chat view into extension context
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.openChat", async () => {
      await vscode.commands.executeCommand("paypilotChatView.focus"); // Focus chat panel
    })
  );

  // Register diff-related commands
  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.openDiff", openSideBySideDiff) // Open diff view
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.acceptChanges", acceptChanges) // Keep changes
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("paypilot.rejectChanges", rejectChanges) // Revert changes
  );

  /**
   * MESSAGE HANDLING SYSTEM - Processes chat messages and AI requests
   */
  chatProvider.onMessage(async (msg: any, panel: any) => {
    if (msg?.type === "chat:ask") {
      try {
        // Use specified model or first available model
        let modelId = msg.model;
        if (!modelId) {
          const availableModels = await getAvailableModels();
          if (availableModels.length === 0) {
            panel.postMessage({
              type: "chat:error",
              error:
                "No language models available. Please enable Copilot or sign in to VS Code.",
            });
            return;
          }
          modelId = availableModels[0].id;
        }

        const editor = vscode.window.activeTextEditor; // Get current active editor for context for llm
        const cfg = vscode.workspace.getConfiguration("paypilot");
        const maxContextChars = Math.max(
          0,
          Number(cfg.get("maxContextChars")) || 0
        );

        // Extract editor context for AI prompt
        let editorContext = "";
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
              const endLine = Math.min(
                totalLines - 1,
                lineNumber + contextRadius
              );

              const contextRange = new vscode.Range(
                startLine,
                0,
                endLine,
                editor.document.lineAt(endLine).text.length
              );
              editorContext = editor.document.getText(contextRange);
            }
          }
        }

        //Build context files content
        let contextFilesContent = "";
        if (msg.contextFiles && msg.contextFiles.length > 0) {
          const contextSections = msg.contextFiles.map((file: any) => {
            return [
              `--- ${file.fileName} ---`,
              `Path: ${file.filePath}`,
              file.content || "// File content not available",
              `--- End of ${file.fileName} ---`,
              "",
            ].join("\n");
          });

          contextFilesContent = [
            "--- Additional Context Files ---",
            ...contextSections,
            "--- End of Additional Context Files ---",
            "",
          ].join("\n");
        }

        const mode = msg.mode || "ask"; // Default to 'ask' mode

        // Compose the prompt based on mode (agent vs ask)
        let composed = "";
        if (mode === "agent") {
          // Agent mode: Request code modifications
          composed = [
            "You are an AI coding assistant. Analyze the user's request and the provided code context.",
            "Your task is to make the requested changes to the code.",
            "Respond with two parts:",
            "1. A brief summary of what you changed (1-2 sentences)",
            "2. The complete modified file content wrapped in a code block",
            "",
            "Format your response like this:",
            "Summary: [Brief description of changes]",
            "",
            "```[language]",
            "[complete code]",
            "```",
            "",
            editorContext ? "--- Current file context ---" : "",
            editorContext || "",
            editorContext ? "--- End of current file context ---" : "",
            "",
            contextFilesContent, //Include context files
            "User request:",
            msg.prompt,
          ]
            .filter((line) => line !== "")
            .join("\n"); // Filter out empty strings
        } else {
          // Ask mode: Answer questions and provide help
          composed = [
            "You are an AI assistant helping with coding questions.",
            "If you provide code, wrap it in code blocks with appropriate language identifiers.",
            "",
            editorContext ? "--- Current file context ---" : "",
            editorContext || "",
            editorContext ? "--- End of current file context ---" : "",
            "",
            contextFilesContent, //Include context files
            "User question:",
            msg.prompt,
          ]
            .filter((line) => line !== "")
            .join("\n"); // Filter out empty strings
        }

        let fullResponse = ""; // Accumulate streaming response

        // Store the current request for potential cancellation
        const abortController = new AbortController();
        currentAbortController = abortController;

        if (mode === "agent") {
          // Agent mode: Show working indicator instead of streaming
          console.log(
            `[PayPilot] 🤖 Starting AGENT MODE - using new direct API implementation`
          );
          panel.postMessage({
            type: "chat:working",
            message: "Analyzing code and preparing changes...",
          });

          try {
            // Make API call without streaming for agent mode
            const fullResponse = await streamChatAgent(
              modelId,
              composed,
              abortController.signal
            );

            currentAbortController = null; // Clear the controller

            // Apply code changes if we have an editor and code
            if (editor) {
              const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/;
              const match = fullResponse.match(codeBlockRegex);

              if (match && match[1]) {
                const newContent = match[1].trim();
                const originalText = editor.document.getText(); // Get current content
                const originalLines = originalText.split("\n");
                const newLines = newContent.split("\n");

                await applyChangesWithVSCodeDiff(newContent);

                // Calculate proper diff stats using LCS-based approach
                const diffStats = calculateDiffStats(
                  originalLines,
                  newLines
                );

                // Debug logging
                console.log("[PayPilot Diff Debug]");
                console.log("Original lines:", originalLines.length);
                console.log("New lines:", newLines.length);
                console.log("Calculated added:", diffStats.added);
                console.log("Calculated deleted:", diffStats.deleted);

                // Extract summary from AI response
                let explanation = "";
                const summaryMatch = fullResponse.match(
                  /Summary:\s*(.+?)(?:\n|$)/i
                );
                if (summaryMatch && summaryMatch[1]) {
                  explanation = summaryMatch[1].trim();
                } else {
                  // Fallback: extract text outside code blocks
                  const aiExplanation = fullResponse
                    .replace(/```[a-zA-Z0-9_-]*\s*[\s\S]*?```/g, "")
                    .trim();
                  explanation =
                    aiExplanation.length > 20 ? aiExplanation : "";
                }

                // Generate a smart summary if no explanation
                if (
                  !explanation &&
                  (diffStats.added > 0 || diffStats.deleted > 0)
                ) {
                  const changes = [];
                  if (diffStats.added > 0) {
                    changes.push(
                      `${diffStats.added} line${
                        diffStats.added > 1 ? "s" : ""
                      } added`
                    );
                  }
                  if (diffStats.deleted > 0) {
                    changes.push(
                      `${diffStats.deleted} line${
                        diffStats.deleted > 1 ? "s" : ""
                      } removed`
                    );
                  }
                  explanation = `Updated code: ${changes.join(", ")}`;
                }

                // Send code applied message
                panel.postMessage({
                  type: "chat:code-applied",
                  fileName:
                    editor.document.fileName.split("/").pop() ||
                    "Unknown file",
                  filePath: editor.document.uri.fsPath,
                  linesAdded: diffStats.added,
                  linesDeleted: diffStats.deleted,
                  explanation,
                });
              } else {
                // No code found, send as regular done message
                panel.postMessage({ type: "chat:done", text: fullResponse });
              }
            } else {
              panel.postMessage({ type: "chat:done", text: fullResponse });
            }
          } catch (agentError) {
            currentAbortController = null;
            console.error("Error in agent mode:", agentError);
            panel.postMessage({
              type: "chat:error",
              error: agentError instanceof Error ? agentError.message : String(agentError),
            });
          }
        } else {
          // Ask mode: Continue with streaming
          console.log(`[PayPilot] Starting Ask Mode`);
          try {
            await streamChatUI(
              modelId,
              composed,
              (token: string) => {
                fullResponse += token;
                panel.postMessage({ type: "chat:stream", token });
              },
              (fullText: string) => {
                currentAbortController = null;
                panel.postMessage({ type: "chat:done", text: fullText });
              },
              abortController.signal
            );
          } catch (chatError) {
            currentAbortController = null;
            console.error("Error in chat mode:", chatError);
            panel.postMessage({
              type: "chat:error",
              error: chatError instanceof Error ? chatError.message : String(chatError),
            });
          }
        }
      } catch (error) {
        currentAbortController = null; // Clear the controller on any error
        console.error("Error in chat:ask handler:", error);
        panel.postMessage({
          type: "chat:error",
          error:
            error instanceof Error
              ? error.message
              : "An unknown error occurred",
        });
      }
    } else if (msg?.type === "chat:stop") {
      // Handle stop generation request
      if (currentAbortController) {
        currentAbortController.abort(); // Cancel the current request
        currentAbortController = null;
        panel.postMessage({ type: "chat:stopped" }); // Notify UI that generation was stopped
      }
    } else if (msg?.type === "model:list-request") {
      // Handle request for available models
      console.log(`[PayPilot] Loading available models`);
      try {
        const models = await getAvailableModels();
        console.log(`[PayPilot] Successfully loaded ${models.length} models`);
        panel.postMessage({
          type: "model:list",
          models,
        });
      } catch (error) {
        console.error("Error getting available models:", error);
        panel.postMessage({
          type: "chat:error",
          error: "Failed to load available models",
        });
      }
    } else if (msg?.type === "model:change") {
      // Handle model change - could store in settings if needed
      console.log("Model changed to:", msg.model);
      // For now, just acknowledge - the model will be used in the next chat:ask
    } else if (msg?.type === "file:open") {
      // Handle file open request from code applied card
      try {
        const uri = vscode.Uri.file(msg.filePath);
        await vscode.window.showTextDocument(uri);
      } catch (error) {
        console.error("Error opening file:", error);
        vscode.window.showErrorMessage(`Failed to open file: ${msg.filePath}`);
      }
    } else if (msg?.type === "context:request") {
      // Handle context file request - show VS Code workspace file picker
      try {
        // Get all files in the workspace
        const workspaceFiles = await vscode.workspace.findFiles(
          "**/*", // Include all files
          "**/node_modules/**" // Exclude node_modules
        );

        if (workspaceFiles.length === 0) {
          vscode.window.showInformationMessage("No files found in workspace");
          return;
        }

        // Create quick pick items from workspace files
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

        // Add option to browse external files
        quickPickItems.unshift({
          label: "📁 Browse files outside workspace...",
          description: "Select files from anywhere on your system",
          detail: "Open file browser",
          uri: null as any, // Special marker for browse option
        });

        // Sort workspace files by file name for better UX (keeping browse option at top)
        const browseOption = quickPickItems.shift();
        quickPickItems.sort((a, b) => a.label.localeCompare(b.label));
        quickPickItems.unshift(browseOption!);

        // Show quick pick for file selection
        const selectedItems = await vscode.window.showQuickPick(
          quickPickItems,
          {
            canPickMany: true,
            placeHolder: "Select files to add to context",
            matchOnDescription: true,
            matchOnDetail: true,
          }
        );

        if (selectedItems && selectedItems.length > 0) {
          // Check if user selected the browse option
          const browseOptionSelected = selectedItems.some((item) => !item.uri);
          const workspaceFilesSelected = selectedItems.filter(
            (item) => item.uri
          );

          let contextFiles: any[] = [];

          // Process workspace files
          if (workspaceFilesSelected.length > 0) {
            const workspaceContextFiles = await Promise.all(
              workspaceFilesSelected.map(async (item) => {
                try {
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
                  console.error(
                    `Error reading file ${item.uri!.fsPath}:`,
                    error
                  );
                  return {
                    filePath: item.uri!.fsPath,
                    fileName: item.label,
                    content: `Error reading file: ${error}`,
                    size: 0,
                  };
                }
              })
            );
            contextFiles.push(...workspaceContextFiles);
          }

          // Handle external file browsing
          if (browseOptionSelected) {
            const externalFiles = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: true,
              openLabel: "Add to Context",
              filters: {
                "All Files": ["*"],
                "Source Code": [
                  "js",
                  "ts",
                  "jsx",
                  "tsx",
                  "py",
                  "java",
                  "cpp",
                  "c",
                  "h",
                  "cs",
                  "php",
                  "rb",
                  "go",
                  "rs",
                  "swift",
                  "kt",
                ],
                "Text Files": [
                  "txt",
                  "md",
                  "json",
                  "xml",
                  "yaml",
                  "yml",
                  "csv",
                ],
              },
            });

            if (externalFiles && externalFiles.length > 0) {
              const externalContextFiles = await Promise.all(
                externalFiles.map(async (file) => {
                  try {
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
              contextFiles.push(...externalContextFiles);
            }
          }

          // Send the context files to the webview (these will be added to existing ones)
          if (contextFiles.length > 0) {
            panel.postMessage({
              type: "context:add",
              files: contextFiles,
            });
          }
        }
      } catch (error) {
        console.error("Error opening file picker:", error);
        panel.postMessage({
          type: "chat:error",
          error: "Failed to open file picker",
        });
      }
    } else if (msg?.type === "context:add") {
      // Handle adding specific files to context
      console.log("Adding files to context:", msg.filePaths);
    } else if (msg?.type === "context:remove") {
      // Handle removing a file from context
      console.log("Removing file from context:", msg.filePath);
    } else if (msg?.type === "context:clear") {
      // Handle clearing all context files
      console.log("Clearing all context files");
    } else if (msg?.type === "mcp:toggle") {
      // Handle MCP toggle
      enableMcp = msg.enabled;
      console.log(`MCP ${enableMcp ? 'enabled' : 'disabled'}`);
    } else if (msg?.type === "mcp:get") {
      // Handle MCP servers request
      try {
        const servers = getMcpServers();
        panel.postMessage({
          type: "mcp:servers",
          servers: servers
        });
      } catch (error) {
        console.error("Error getting MCP servers:", error);
        panel.postMessage({
          type: "chat:error",
          error: "Failed to load MCP servers"
        });
      }
    } // End of message handling
  });
}

export function deactivate() {
  cleanupDiffResources(); // Clean up all extension resources on deactivation
}
