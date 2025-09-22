# PayPilot – VS Code AI Assistant Extension

PayPilot brings a Copilot-style chat experience into a dedicated side panel. The extension streams responses from any language model exposed through VS Code's `vscode.lm` API, optionally applies suggested edits, and keeps review tooling (diffs, status-bar actions) in sync with what the AI changed.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ VS Code Extension Host (Node runtime)                            │
│ ┌───────────────┐    ┌────────────────────────────────────────┐ │
│ │ extension.ts  │───▶│ MessageHandlerService                  │ │
│ │ activation &  │    │ (chat orchestration & service hub)     │ │
│ │ registrations │    ├────────────────────────────────────────┤ │
│ └───────────────┘    │ DiffService ↔ OriginalContentProvider  │ │
│                      │ FileModificationService                │ │
│                      │ StatusBarService                       │ │
│                      │ ContextService                         │ │
│                      │ McpService                             │ │
│                      │ Prompt / Model / Context / MCP bridges │ │
│                      └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                ▲ webview.postMessage / onDidReceiveMessage ▼
┌──────────────────────────────────────────────────────────────────┐
│ Webview (React app, browser runtime)                             │
│  VSCodeContext ➝ Chat UI components ➝ Streaming render pipeline  │
└──────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities & VS Code API Usage

### Activation & Routing (extension host)
- `src/extension.ts` wires the extension together by creating a `MessageHandlerService`, instantiating the `ChatViewProvider`, and registering all commands that surface PayPilot features. **VS Code APIs:** `vscode.window.registerWebviewViewProvider`, `vscode.commands.registerCommand`, `vscode.commands.executeCommand`, `vscode.lm.onDidChangeChatModels`, `vscode.ExtensionContext.subscriptions`.
- `src/panels/ChatViewProvider.ts` hosts the sidebar webview, loads the bundled React app, and relays messages. **VS Code APIs:** `vscode.WebviewViewProvider`, `webview.asWebviewUri`, `vscode.Uri.joinPath`, `webview.options`, `webview.html`, `webview.onDidReceiveMessage`, `webview.postMessage`.
- `src/services/chat/messageHandlerService.ts` is the orchestration hub. It receives webview messages, coordinates downstream services, and keeps long-lived feature state. **VS Code APIs:** `vscode.Memento` (workspace state), `vscode.window.showInformationMessage`, `vscode.window.showWarningMessage`, `vscode.workspace.getConfiguration`, `vscode.CancellationTokenSource`, `vscode.LanguageModelChat`, `vscode.Webview.postMessage`.

### Language Model Execution
- `src/services/languageModel.ts` discovers models and streams responses using VS Code's experimental LM API. **VS Code APIs:** `vscode.lm.selectChatModels`, `vscode.LanguageModelChatMessage.User`, `vscode.LanguageModelChat.sendRequest`, `vscode.CancellationTokenSource`.
- `src/services/chat/modelMessageService.ts` pushes model lists into the webview and logs selection changes. **VS Code APIs:** `vscode.Webview.postMessage`.
- `src/services/chat/promptService.ts` shapes prompts for "ask" and "agent" modes (no direct VS Code dependencies).

### Context & Prompt Expansion
- `src/services/contextService.ts` owns the set of context files shared with the AI. It prompts the user for files, reads file content, and builds context snippets. **VS Code APIs:** `vscode.workspace.findFiles`, `vscode.workspace.getWorkspaceFolder`, `vscode.workspace.asRelativePath`, `vscode.window.showQuickPick`, `vscode.window.showOpenDialog`, `vscode.workspace.fs.readFile`, `vscode.workspace.fs.stat`.
- `src/services/chat/contextMessageService.ts` bridges webview requests to `ContextService` and pipes results back. **VS Code APIs:** `vscode.Webview.postMessage`.

### File Modification & Diff Workflow
- `src/services/fileModificationService.ts` parses streamed AI output, resolves file paths, applies edits, and notifies the UI. **VS Code APIs:** `vscode.window.activeTextEditor`, `vscode.workspace.openTextDocument`, `vscode.window.showTextDocument`, `vscode.WorkspaceEdit`, `vscode.Range`, `vscode.workspace.applyEdit`, `vscode.workspace.fs.readFile`, `vscode.workspace.fs.stat`, `vscode.Uri.file`, `vscode.Webview.postMessage`.
- `src/services/diff/diffService.ts` tracks every file the AI touched, exposes preserved originals, drives diff tabs, and refreshes status-bar buttons. **VS Code APIs:** `vscode.workspace.registerTextDocumentContentProvider`, `vscode.window.onDidChangeActiveTextEditor`, `vscode.window.showInformationMessage`, `vscode.window.showWarningMessage`, `vscode.commands.executeCommand('vscode.diff')`, `vscode.window.tabGroups`, `vscode.TabInputTextDiff`, `vscode.window.tabGroups.close`, `vscode.window.showTextDocument`, `vscode.ViewColumn`, `vscode.workspace.openTextDocument`, `vscode.WorkspaceEdit`, `vscode.Range`, `vscode.workspace.applyEdit`, `vscode.Uri.file`, `vscode.window.activeTextEditor`.
- `src/services/diff/originalContentProvider.ts` implements `vscode.TextDocumentContentProvider` so the diff editor can render the AI's baseline snapshot. **VS Code APIs:** `vscode.TextDocumentContentProvider`, `vscode.EventEmitter`.
- `src/services/statusBarService.ts` shows context-aware status-bar controls (Accept/Reject/Keep/Undo/View Diff). **VS Code APIs:** `vscode.window.createStatusBarItem`, `vscode.StatusBarAlignment`, `vscode.ThemeColor`.

### MCP & Session Utilities
- `src/services/mcpService.ts` ensures the recommended Context7 MCP server is registered in user settings and exposes configured servers. **VS Code APIs:** `vscode.workspace.getConfiguration`, `vscode.ConfigurationTarget.Global`.
- `src/services/chat/mcpMessageService.ts` toggles MCP participation and returns server lists to the webview. **VS Code APIs:** `vscode.Webview.postMessage`.
- `src/services/chat/chatHistoryService.ts` is an in-memory placeholder for session summaries (no VS Code APIs yet).

### Webview Application (React)
- `src/webview/context/VSCodeContext.tsx` captures the VS Code messaging handle and wraps `window.acquireVsCodeApi`, providing typed `postMessage`/`onMessage` helpers to the React tree.
- `src/webview/components` and hooks (notably `useChat.ts`) consume that context to render streaming output, fire chat requests, and display diff summaries received from the extension.

## Request Lifecycles

### Ask Mode (no edits)
1. User submits a prompt in the chat webview. `useChat` posts `{ type: 'chat:ask', mode: 'ask', ... }`.
2. `MessageHandlerService.handleMessage` invokes `PromptService` to compose the prompt, then asks `languageModel.streamLanguageModel` for a streaming response.
3. Tokens are relayed back to the webview as `chat:stream` messages. The panel renders incrementally and, when complete, receives `chat:response`.
4. No file modifications are attempted, so `DiffService`/`StatusBarService` remain idle.

### Agent Mode (code edits)
1. The chat panel sends `{ type: 'chat:ask', mode: 'agent', contextFiles: [...] }`.
2. `MessageHandlerService` loads the requested language model, pulls editor context via `ContextService`, and streams the AI reply.
3. Once streaming finishes, `FileModificationService.parseMultipleFileModifications` extracts `File:` blocks, verifies that each path exists, and applies edits through `WorkspaceEdit`.
4. Every successful edit triggers a `chat:code-applied` post back to the webview and is handed to `DiffService.trackModifiedFiles` so the original snapshot is preserved.
5. `DiffService` recalculates tracked state; `StatusBarService.showEnhancedDiffButtons` paints Accept/Reject/Keep/Undo controls while the chat panel is visible.
6. If the user invokes a status-bar command (e.g. Accept All), command handlers in `extension.ts` call back into `DiffService`, which uses diff tabs and workspace edits to implement the action.

## VS Code API Inventory

| Area | Files | Primary APIs |
| --- | --- | --- |
| Activation & commands | `src/extension.ts` | `window.registerWebviewViewProvider`, `commands.registerCommand`, `commands.executeCommand`, `lm.onDidChangeChatModels` |
| Webview host | `src/panels/ChatViewProvider.ts`, `src/services/html.ts` | `WebviewViewProvider`, `webview.asWebviewUri`, `Uri.joinPath`, `Webview.postMessage` |
| Language models | `src/services/languageModel.ts` | `lm.selectChatModels`, `LanguageModelChatMessage.User`, `LanguageModelChat.sendRequest`, `CancellationTokenSource` |
| Context capture | `src/services/contextService.ts` | `workspace.findFiles`, `window.showQuickPick`, `workspace.fs.readFile`, `window.showOpenDialog`, `workspace.fs.stat` |
| File edits & diffing | `src/services/fileModificationService.ts`, `src/services/diff/diffService.ts`, `src/services/diff/originalContentProvider.ts` | `workspace.openTextDocument`, `workspace.registerTextDocumentContentProvider`, `commands.executeCommand('vscode.diff')`, `WorkspaceEdit`, `Range`, `workspace.applyEdit`, `window.tabGroups`, `window.showTextDocument` |
| Status UI | `src/services/statusBarService.ts` | `window.createStatusBarItem`, `ThemeColor`, `StatusBarAlignment` |
| MCP configuration | `src/services/mcpService.ts` | `workspace.getConfiguration`, `ConfigurationTarget.Global` |
| Webview runtime | `src/webview/context/VSCodeContext.tsx` | `window.acquireVsCodeApi`, `postMessage`, `message` event listener |

## Development

```bash
npm install            # install dependencies

npm run watch          # bundle extension + webview in watch mode
# or run the individual tasks
npm run watch:tsc      # incremental type-checking
npm run watch:esbuild  # incremental bundling

# Launch the Extension Development Host from VS Code (F5)
```

Tips:
- The build outputs land in `dist/extension.js` (extension host) and `dist/media` (webview bundle & styles).
- Use `Developer: Open Webview Developer Tools` inside the chat panel to debug the React app.
- Diff/status commands are available from the command palette (`paypilot.*`) and from the status bar while the chat panel is open.
