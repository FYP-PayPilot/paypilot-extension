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
      "- paypilot-workspaceContext → read files or list directories.",
      "- paypilot-readFile → retrieve a single file's contents when you only need one target.",
      "- paypilot-createDirectory → create folders before adding new files as needed.",
      "- paypilot-createFile → create a new file with provided contents.",
      "- paypilot-updateFile → replace part or all of an existing file (supply the full desired contents).",
      "- paypilot-deleteFile → remove an individual file from the workspace.",
      "- paypilot-deleteDirectory → remove a directory (and optionally its contents).",
      "Workflow:",
      "1. Call paypilot-workspaceContext immediately to map out the relevant portion of the workspace. Capture the current structure before you create, update, or delete anything.",
      "2. After every tool call that changes the filesystem, invoke paypilot-workspaceContext again so you always act on the latest structure.",
      "3. When the user references a directory or file name that might be abbreviated or formatted differently (e.g., spaces vs. dashes), list nearby matches with paypilot-workspaceContext and pick the closest existing path before taking action.",
      "4. When you need the full content of a specific file, use paypilot-readFile.",
      "5. Treat the directory listings as authoritative—use them to decide which subdirectory is the best home for new files, and only create a new folder when no close match exists.",
      "6. Use the appropriate create/update/delete/deleteDirectory tool to make each requested change.",
      "7. If you remove directories, confirm the deletion and list notable files that were removed.",
      "8. After finishing tool calls, reply with a concise summary of what changed and include key code snippets if helpful.",
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
      "When answering questions about the codebase or overall architecture, call the paypilot-workspaceContext tool to gather an up-to-date overview of the relevant folders and files.",
      "If the user references a directory or file name approximately (e.g., missing dashes), look for the closest matches in the workspace listing and base your explanation or guidance on that existing path.",
      "Use the returned structure to orient yourself and reference directories accurately when explaining the project or recommending where new code should live.",
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
