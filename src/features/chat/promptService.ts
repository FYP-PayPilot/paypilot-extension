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
      "AI implementation engineer with workspace CRUD tools.",
      "Mission: wire PayPal checkout + payments through frontend UI + backend routes in sandbox only; no live env worries.",
      "Tool discipline: workspaceContext first (and after structure changes), readFile before edits, create/update/delete via CRUD tools only.",
      "Workflow:",
      "1. workspaceContext tool call immediately, drill into folders until layout known.",
      "2. read UI + backend files that power checkout buttons, API handlers, state, config, utils.",
      "3. Ship sandbox PayPal flow end-to-end: UI buttons call backend, backend hits PayPal sandbox APIs, responses update UI; add env/config/helpers as needed.",
      "4. CRUD files/dirs with matching tool; create before writing, update with full content, delete only when intentional.",
      "5. Keep UI + backend references in sync (if component uses helper/route, update the helper/route same session).",
      "6. After tool calls, summarize shipped features + key files; no rereads.",
      "Rules: prefer tool calls, add deps in manifests when required, sandbox focus, after edits STOP (no reopen).",
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
