/**
 * Builds chat prompts for both "ask" and "agent" modes.
 */
export class PromptService {
  /**
   * Compose the final prompt sent to the language model based on the requested mode.
   * @param msg Original message payload from the webview.
   * @param mode Either "agent" or "ask" (defaults to ask).
   * @param editorContext Snippet captured from the active editor.
   * @param contextFilesContent Formatted string of additional context files.
   */
  composePrompt(
    msg: any,
    mode: string,
    editorContext: string,
    contextFilesContent: string
  ): string {
    if (mode === "agent") {
      return this.composeAgentPrompt(msg, editorContext, contextFilesContent);
    }
    return this.composeAskPrompt(msg, editorContext, contextFilesContent);
  }

  private composeAgentPrompt(
    msg: any,
    editorContext: string,
    contextFilesContent: string
  ): string {
    return [
      "You are an AI coding assistant with direct access to workspace tools.",
      "Always use the tools to inspect files and apply edits instead of describing manual steps.",
      "Available tools:",
      "- paypilot-workspaceContext → discover files using glob patterns with vscode.workspace.findFiles API.",
      "- paypilot-readFile → retrieve a single file's contents when you only need one target.",
      "- paypilot-createDirectory → create folders before adding new files as needed.",
      "- paypilot-createFile → create a new file with provided contents.",
      "- paypilot-updateFile → replace part or all of an existing file (supply the full desired contents).",
      "- paypilot-deleteFile → remove files or directories from the workspace.",
      "- paypilot-moveFile → move or rename files and directories.",
      "Iterative Discovery Workflow:",
      "1. ALWAYS start by creating a plan to fulfill the user's objectives.",
      "2. Use paypilot-workspaceContext with specific glob patterns to discover correct file paths (e.g., '**/*.ts', 'src/components/**').",
      "3. Use the exact file paths returned by workspaceContext - never guess or assume file locations.",
      "4. For nested file operations, use progressively specific glob patterns to drill down to the target files.",
      "5. After every filesystem change, re-run paypilot-workspaceContext to verify the current state.",
      "6. When you need file contents, use paypilot-readFile with the exact paths from workspaceContext.",
      "7. Use paypilot-moveFile for renaming or relocating files/directories.",
      "8. Treat workspaceContext results as authoritative - base all file operations on discovered paths.",
      "9. Complete the plan iteratively: discover → read → modify → verify → repeat until objectives are met.",
      "Important: Do NOT emit custom 'File:' or 'Operation:' blocks—rely on the tools to perform edits.",
      editorContext ? "--- Current file context ---" : "",
      editorContext || "",
      editorContext ? "--- End of current file context ---" : "",
      "",
      contextFilesContent,
      "User request:",
      msg.prompt,
    ].filter((line) => line !== "").join("\n");
  }

  private composeAskPrompt(
    msg: any,
    editorContext: string,
    contextFilesContent: string
  ): string {
    return [
      "You are an AI assistant helping with coding questions.",
      "Discovery-First Approach:",
      "1. Use paypilot-workspaceContext with specific glob patterns to discover relevant files (e.g., 'src/**/*.ts', '**/*test*').",
      "2. Base all answers on the exact file paths and structure returned by workspaceContext.",
      "3. When explaining architecture or recommending locations for new code, reference the discovered structure.",
      "4. If the user references files approximately, use workspaceContext to find the closest matches.",
      "If you provide code, wrap it in code blocks with appropriate language identifiers.",
      "",
      editorContext ? "--- Current file context ---" : "",
      editorContext || "",
      editorContext ? "--- End of current file context ---" : "",
      "",
      contextFilesContent,
      "User question:",
      msg.prompt,
    ].filter((line) => line !== "").join("\n");
  }
}
