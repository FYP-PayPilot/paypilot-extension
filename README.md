# PayPilot – VS Code AI Assistant Extension

PayPilot delivers a Copilot-style chat experience inside a dedicated sidebar. The extension streams responses from any language model exposed through VS Code's `vscode.lm` API, can apply the model’s edits directly to your workspace, and keeps review tooling (diffs, status-bar actions) in sync with what changed.

## Domain-Oriented Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ VS Code Extension Host (Node runtime)                               │
│ ┌───────────────┐        ┌───────────────────────────────────────┐ │
│ │ extension.ts  │ ─────▶ │ Chat Domain                           │ │
│ │ activation &  │        │  MessageHandlerService                │ │
│ │ command setup │        │  PromptService / ChatHistoryService   │ │
│ └───────────────┘        └───────────────────────────────────────┘ │
│             │                             │                         │
│             ▼                             ▼                         │
│    ┌─────────────────┐        ┌───────────────────────────────┐     │
│    │ Diff Domain     │        │ Context Domain               │     │
│    │  DiffService    │        │  ContextService              │     │
│    │  StatusBar      │        │  ContextMessageService       │     │
│    │  Original Docs  │        └───────────────────────────────┘     │
│    └─────────────────┘                             │                │
│             │                                     ▼                │
│             ▼                             ┌────────────────────┐    │
│    ┌─────────────────┐        ┌────────── │ Language Model     │    │
│    │ File-Mod Domain │        │           │  languageModelSvc  │    │
│    │  FileModificationService│           │  ModelMessageSvc   │    │
│    └─────────────────┘        │           └────────────────────┘    │
│                               │                     │              │
│                               ▼                     ▼              │
│                    ┌─────────────────┐     ┌─────────────────┐      │
│                    │ MCP Domain      │     │ Infrastructure   │      │
│                    │  McpService     │     │  htmlService     │      │
│                    │  McpMessageSvc  │     └─────────────────┘      │
│                    └─────────────────┘                               │
└─────────────────────────────────────────────────────────────────────┘
                     ▲ webview.postMessage / onDidReceiveMessage ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Webview (React app, browser runtime)                                │
│  VSCodeContext ➝ Chat UI components ➝ Streaming render pipeline     │
└─────────────────────────────────────────────────────────────────────┘
```

Each folder under `src/features` represents a domain module that owns its logic (`Service` files) and any chat/webview bridge responsible for messaging (`*MessageService` files). Shared utilities live in `src/infrastructure`, while panel wiring remains in `src/panels`.

## Feature Breakdown

### Chat Domain (`src/features/chat`)
- `messageHandlerService.ts`: Central coordinator that routes webview events, composes prompts, triggers edits, and orchestrates other domains. **VS Code APIs:** `vscode.Memento`, `vscode.workspace.getConfiguration`, `vscode.CancellationTokenSource`, `vscode.Webview.postMessage`, `vscode.window.showInformationMessage`, `vscode.window.showWarningMessage`.
- `promptService.ts`: Builds prompts for *ask* and *agent* modes. Pure string composition.
- `chatHistoryService.ts`: Placeholder in-memory session list for future persistence.

### Diff Domain (`src/features/diff`)
- `diffService.ts`: Tracks AI-modified files, presents diffs, and keeps workspace state in sync. **VS Code APIs:** `vscode.workspace.registerTextDocumentContentProvider`, `vscode.window.onDidChangeActiveTextEditor`, `vscode.commands.executeCommand('vscode.diff')`, `vscode.window.tabGroups`, `vscode.window.showInformationMessage`, `vscode.window.showWarningMessage`, `vscode.workspace.openTextDocument`, `vscode.WorkspaceEdit`, `vscode.Range`, `vscode.workspace.applyEdit`, `vscode.Uri.file`.
- `originalContentProvider.ts`: Implements `vscode.TextDocumentContentProvider` so diff editors can show captured baselines.
- `statusBarService.ts`: Renders Accept/Reject/Keep/Undo/View Diff buttons when tracked changes exist. **VS Code APIs:** `vscode.window.createStatusBarItem`, `vscode.StatusBarAlignment`, `vscode.ThemeColor`.

### Context Domain (`src/features/context`)
- `contextService.ts`: Manages context files chosen by the user, including workspace discovery and external file browsing. **VS Code APIs:** `vscode.workspace.findFiles`, `vscode.workspace.getWorkspaceFolder`, `vscode.workspace.asRelativePath`, `vscode.window.showQuickPick`, `vscode.window.showOpenDialog`, `vscode.workspace.fs.readFile`, `vscode.workspace.fs.stat`.
- `contextMessageService.ts`: Bridges chat requests (add/remove/clear/context pickup) to `ContextService` and forwards results.

### Language Model Domain (`src/features/language-model`)
- `languageModelService.ts`: Discovers available models and streams responses using the Language Model API. **VS Code APIs:** `vscode.lm.selectChatModels`, `vscode.LanguageModelChatMessage.User`, `vscode.LanguageModelChat.sendRequest`, `vscode.CancellationTokenSource`.
- `modelMessageService.ts`: Returns model lists to the webview and logs model switches.

### MCP Domain (`src/features/mcp`)
- `mcpService.ts`: Ensures the recommended Context7 MCP server is configured and exposes registered servers. **VS Code APIs:** `vscode.workspace.getConfiguration`, `vscode.ConfigurationTarget.Global`.
- `mcpMessageService.ts`: Toggles MCP participation and sends server details back to the UI when requested.

### Infrastructure (`src/infrastructure`)
- `htmlService.ts`: Generates the webview HTML shell with CSP, nonces, and embedded CSS. **VS Code APIs:** `webview.cspSource`, `webview.asWebviewUri`, `vscode.Uri.joinPath`.

### Panel & Webview
- `src/panels/ChatViewProvider.ts`: Hosts the sidebar webview and wires message passing. **VS Code APIs:** `vscode.WebviewViewProvider`, `webview.asWebviewUri`, `webview.onDidReceiveMessage`, `webview.postMessage`.
- `src/webview/**`: React application that renders the chat UI, handles streaming, and surfaces status updates. `VSCodeContext.tsx` calls `window.acquireVsCodeApi()`; hooks/components consume that channel.

## Cross-Domain Message Flow

### Ask Mode (analysis only)
1. Webview sends `{ type: 'chat:ask', mode: 'ask', ... }` through `VSCodeContext`.
2. `MessageHandlerService` composes the prompt via `PromptService` and streams the answer with `languageModelService.streamLanguageModel`.
3. Streaming tokens are forwarded to the webview as `chat:stream`; the final response arrives as `chat:response`.
4. No file modifications occur, so the Diff and File-Mod domains remain idle.

### Agent Mode (code edits)
1. Webview includes `mode: 'agent'` plus optional context file hints.
2. `MessageHandlerService` gathers editor context (`ContextService`), streams the language model response, and responds to tool calls (`paypilot-…` tools) by invoking `vscode.lm.invokeTool`.
3. Tool executions perform the requested filesystem changes and emit `chat:code-applied` updates back to the webview.
4. `DiffService.trackModifiedFiles` snapshots originals and refreshes status-bar controls via `StatusBarService`.
5. Accept/Reject/Keep/Undo commands (triggered via status bar or command palette) call `diffService` methods to manage the tracked files.

## VS Code API Inventory (by module)

| Domain / Area | Files | Key APIs |
| --- | --- | --- |
| Activation & panel | `src/extension.ts`, `src/panels/ChatViewProvider.ts` | `window.registerWebviewViewProvider`, `commands.registerCommand`, `commands.executeCommand`, `lm.onDidChangeChatModels`, `webview.postMessage`, `Uri.joinPath` |
| Chat orchestration | `src/features/chat/messageHandlerService.ts` | `Memento`, `workspace.getConfiguration`, `CancellationTokenSource`, `window.showInformationMessage`, `window.showWarningMessage`, `Webview.postMessage` |
| Language models | `src/features/language-model/languageModelService.ts` | `lm.selectChatModels`, `LanguageModelChatMessage.User`, `LanguageModelChat.sendRequest`, `CancellationTokenSource` |
| Context capture | `src/features/context/contextService.ts` | `workspace.findFiles`, `window.showQuickPick`, `window.showOpenDialog`, `workspace.fs.readFile`, `workspace.fs.stat`, `workspace.asRelativePath` |
| LLM tools | `src/tools.ts`, `src/utils/workspace.ts` | `lm.registerTool`, `lm.invokeTool`, `workspace.fs.writeFile`, `workspace.fs.delete`, `workspace.findFiles` |
| Diff & review | `src/features/diff/diffService.ts`, `src/features/diff/originalContentProvider.ts`, `src/features/diff/statusBarService.ts` | `workspace.registerTextDocumentContentProvider`, `commands.executeCommand('vscode.diff')`, `window.tabGroups`, `window.createStatusBarItem`, `ThemeColor` |
| MCP integration | `src/features/mcp/mcpService.ts`, `src/features/mcp/mcpMessageService.ts` | `workspace.getConfiguration`, `ConfigurationTarget.Global`, `Webview.postMessage` |
| Webview HTML | `src/infrastructure/htmlService.ts` | `webview.cspSource`, `webview.asWebviewUri`, `Uri.joinPath` |

## Development

```bash
npm install            # install dependencies

npm run watch          # watch-mode build for extension + webview bundles
# or run the individual tasks
npm run watch:tsc      # incremental type-checking
npm run watch:esbuild  # incremental bundling

# Launch the Extension Development Host from VS Code (F5)
```

Tips:
- Bundles emit to `dist/extension.js` (extension host) and `dist/media/` (webview assets).
- Use **Developer: Open Webview Developer Tools** inside the chat sidebar to debug the React app.
- Diff/status commands are available via the command palette (`paypilot.*`) and from the status bar while the chat panel is open.
