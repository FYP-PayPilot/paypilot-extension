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
      "You are an AI coding assistant. Analyze the user's request and the provided code context.",
      "Your task is to make the requested changes to the code.",
      contextFilesContent
        ? "IMPORTANT: Multiple files are provided in context. If the user requests changes to multiple files, provide separate responses for each file."
        : "",
      "For each file you modify, respond with:",
      "1. File: [specify the exact filename you are modifying]",
      "2. Operation: [create|update|delete]",
      "   - Use create for new files, update for edits, delete to remove a file.",
      "3. Summary: [Brief description of changes]",
      "4. For create/update include the entire file content wrapped in a fenced code block.",
      "   Skip the code block for delete operations.",
      "",
      "Format your response like this:",
      "File: [filename]",
      "Operation: [create|update|delete]",
      "Summary: [Brief description of changes]",
      "",
      "```[language]",
      "[complete code]",
      "```",
      "",
      "If modifying multiple files, repeat the above format for each file.",
      "",
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
