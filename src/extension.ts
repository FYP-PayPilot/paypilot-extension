import * as vscode from "vscode";
import { ChatViewProvider } from "./panels/ChatViewProvider";
import {
  getAvailableModels,
  sendLanguageModelRequest,
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

// AI generation cancellation
let currentAbortController: AbortController | null = null; // For cancelling ongoing AI requests

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
  cleanupStatusBarItems();

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

  // Show action buttons
  showDiffActionButtons();

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
 * Toggle side-by-side diff view using VS Code's native diff editor
 */
async function openSideBySideDiff() {
  if (!currentDocumentUri || !originalContent) {
    vscode.window.showErrorMessage("No changes to diff");
    return; // No diff state available
  }

  // Check if diff is already open by trying to close it first
  if (diffViewColumn !== undefined) {
    // Close the diff view by focusing on it and closing the tab
    try {
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor"
      );
      diffViewColumn = undefined;

      // Update button text to indicate it will open diff
      if (diffButton) {
        diffButton.text = "$(diff) View Diff";
        diffButton.tooltip = "View side-by-side diff of PayPilot changes";
      }

      console.log("[PayPilot] Diff view closed");
      return;
    } catch (error) {
      console.log(
        "[PayPilot] Could not close diff view, proceeding to open new one"
      );
      diffViewColumn = undefined;
    }
  }

  console.log("[PayPilot] Opening side-by-side diff");

  // Create URIs for original and modified content using simplified scheme
  const originalUri = vscode.Uri.parse(
    `paypilot-original:${currentDocumentUri.path}`
  );

  console.log("[PayPilot] Original URI:", originalUri.toString());
  console.log("[PayPilot] Modified URI:", currentDocumentUri.toString());

  try {
    // Open diff editor using VS Code's built-in diff command
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri, // Left side: original content
      currentDocumentUri, // Right side: current content
      "PayPilot Changes (Original ↔ Modified)", // Diff tab title
      { viewColumn: vscode.ViewColumn.Beside } // Open in new column
    );

    // Track that diff is now open
    diffViewColumn = vscode.ViewColumn.Beside;

    // Update button text to indicate it will close diff
    if (diffButton) {
      diffButton.text = "$(x) Close Diff";
      diffButton.tooltip = "Close diff view";
    }

    console.log("[PayPilot] Diff editor opened successfully");
  } catch (error) {
    console.error("[PayPilot] Error opening diff editor:", error);
    vscode.window.showErrorMessage(
      `Failed to open diff view: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
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

  // Clean up any existing buttons first
  cleanupStatusBarItems(); // Prevent duplicate buttons

  // Create status bar items
  diffButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    2001
  );
  diffButton.text = "$(diff) View Diff";
  diffButton.command = "paypilot.openDiff"; // Command to open side-by-side diff
  diffButton.tooltip = "Open side-by-side diff view";
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

  // Reset diff view tracking
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
  cleanupDiffResources(); // Remove diff UI and keep current content
  vscode.window.showInformationMessage("Changes accepted successfully");
}

/**
 * Reject all changes (restore original content)
 */
async function rejectChanges() {
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

  cleanupDiffResources(); // Remove diff UI after reverting
  vscode.window.showInformationMessage("Changes rejected successfully");
}

/**
 * Extension activation function
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log("PayPilot extension is active (VS Code Language Model API)");

  // Initialize chat view provider
  const chatProvider = new ChatViewProvider(context);

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
          const availableModels = await getAvailableModels(context);
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

        const editor = vscode.window.activeTextEditor;
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
            editorContext ? "--- End of context ---" : "",
            "",
            "User request:",
            msg.prompt,
          ].join("\n");
        } else {
          // Ask mode: Answer questions and provide help
          composed = [
            "You are an AI assistant helping with coding questions.",
            "If you provide code, wrap it in code blocks with appropriate language identifiers.",
            "",
            editorContext ? "--- Current file context ---" : "",
            editorContext || "",
            editorContext ? "--- End of context ---" : "",
            "",
            "User question:",
            msg.prompt,
          ].join("\n");
        }

        let fullResponse = ""; // Accumulate streaming response

        // Store the current request for potential cancellation
        const abortController = new AbortController();
        currentAbortController = abortController;

        if (mode === "agent") {
          // Agent mode: Show working indicator instead of streaming
          panel.postMessage({
            type: "chat:working",
            message: "Analyzing code and preparing changes...",
          });

          // Make API call without streaming for agent mode
          await sendLanguageModelRequest(
            {
              modelId,
              prompt: composed,
              abortSignal: abortController.signal,
              onToken: (t) => {
                fullResponse += t; // Build complete response without streaming to UI
              },
              onDone: async (full) => {
                currentAbortController = null; // Clear the controller

                // Apply code changes if we have an editor and code
                if (editor) {
                  const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/;
                  const match = full.match(codeBlockRegex);

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
                    const summaryMatch = full.match(
                      /Summary:\s*(.+?)(?:\n|$)/i
                    );
                    if (summaryMatch && summaryMatch[1]) {
                      explanation = summaryMatch[1].trim();
                    } else {
                      // Fallback: extract text outside code blocks
                      const aiExplanation = full
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
                      if (diffStats.added > 0)
                        {changes.push(
                          `${diffStats.added} line${
                            diffStats.added > 1 ? "s" : ""
                          } added`
                        );}
                      if (diffStats.deleted > 0)
                        {changes.push(
                          `${diffStats.deleted} line${
                            diffStats.deleted > 1 ? "s" : ""
                          } removed`
                        );}
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
                    panel.postMessage({ type: "chat:done", text: full });
                  }
                } else {
                  panel.postMessage({ type: "chat:done", text: full });
                }
              },
              onError: (err) => {
                currentAbortController = null; // Clear the controller
                panel.postMessage({
                  type: "chat:error",
                  error: err instanceof Error ? err.message : String(err), // Send error to UI
                });
              },
            },
            context
          );
        } else {
          // Ask mode: Continue with streaming as before
          await sendLanguageModelRequest(
            {
              modelId,
              prompt: composed,
              abortSignal: abortController.signal,
              onToken: (t) => {
                fullResponse += t; // Build complete response
                panel.postMessage({ type: "chat:stream", token: t }); // Stream to UI
              },
              onDone: async (full) => {
                currentAbortController = null; // Clear the controller
                panel.postMessage({ type: "chat:done", text: full }); // Notify UI completion
              },
              onError: (err) => {
                currentAbortController = null; // Clear the controller
                panel.postMessage({
                  type: "chat:error",
                  error: err instanceof Error ? err.message : String(err), // Send error to UI
                });
              },
            },
            context
          );
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
      try {
        const models = await getAvailableModels(context);
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
    } // End of message handling
  });
}

export function deactivate() {
  cleanupDiffResources(); // Clean up all extension resources on deactivation
}
