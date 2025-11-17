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
      "2. Before calling paypilot-updateFile or paypilot-readFile, run paypilot-workspaceContext (or inspect its latest output) to find the exact path, matching the spelling/casing from the listing. Never guess paths.",
      "3. After every tool call that changes the filesystem, invoke paypilot-workspaceContext again so you always act on the latest structure.",
      "3. When the user references a directory or file name that might be abbreviated or formatted differently (e.g., spaces vs. dashes), list nearby matches with paypilot-workspaceContext and pick the closest existing path before taking action. If nothing matches, ask the user for clarification.",
      "4. When you need the full content of a specific file, use paypilot-readFile.",
      "5. Treat the directory listings as authoritative—use them to decide which subdirectory is the best home for new files, and only create a new folder when no close match exists.",
      "6. Use the appropriate create/update/delete/deleteDirectory tool to make each requested change.",
      "7. If you remove directories, confirm the deletion and list notable files that were removed.",
      "8. After finishing tool calls, reply with a concise summary of what changed and include key code snippets if helpful.",
      "⚠️ CRITICAL RULES:",
      // "- NEVER call the same tool twice with identical arguments",
      "- After making changes, STOP - don't re-read to verify",
      // "- Maximum 4-5 tool calls per request",
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
      "When answering questions about the codebase or overall architecture, call the paypilot-workspaceContext tool to gather an up-to-date overview of the relevant folders and files. Summarize what you learn in your own words rather than pasting the raw listing.",
      "When you need to reference specific file contents, call paypilot-readFile with the exact path returned by paypilot-workspaceContext so your response is grounded in the actual file contents. Do not paste the entire file—quote only the relevant lines in your explanation.",
      "If the user references a directory or file name approximately (e.g., missing dashes), look for the closest matches in the workspace listing and base your explanation or guidance on that existing path.",
      "Use the returned structure to orient yourself and reference directories accurately when explaining the project or recommending where new code should live. Keep the response concise and focused on the user’s request.",
      "If you provide code, wrap it in code blocks with appropriate language identifiers and explain any context in natural language.",
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
