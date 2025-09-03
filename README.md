# PayPilot - VS Code AI Assistant Extension

An AI-powered coding assistant that integrates with VS Code's Language Model API to provide intelligent code suggestions through a chat interface with real-time streaming responses.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                   │ ← Node.js Environment
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐│
│  │   extension.ts  │←→│ ChatViewProvider │←→│languageModel││
│  │  (Entry Point)  │  │   (Bridge)       │  │ (VS Code API││
│  │                 │  │                  │  │  Integration)││
│  └─────────────────┘  └──────────────────┘  └─────────────┘│
└─────────────────────────────────────────────────────────────┘
                              ↕ postMessage API
┌─────────────────────────────────────────────────────────────┐
│                      Webview (Browser)                     │ ← React App
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐│
│  │   React App     │←→│   VSCodeContext  │←→│ Chat UI     ││
│  │  (UI Layer)     │  │  (Communication) │  │ (Streaming) ││
│  └─────────────────┘  └──────────────────┘  └─────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure & File Relationships

### **Extension Core (Node.js Environment)**
- **[`src/extension.ts`](src/extension.ts)** - Main entry point, registers chat panel and commands
  - Uses: `vscode.window.registerWebviewViewProvider()`, `vscode.commands.registerCommand()`
  - Handles: AI requests, diff management, status bar buttons
  - Connects to: [`ChatViewProvider`](src/panels/ChatViewProvider.ts), [`languageModel`](src/services/languageModel.ts)

- **[`src/panels/ChatViewProvider.ts`](src/panels/ChatViewProvider.ts)** - Webview container and message router
  - Uses: `vscode.WebviewView`, `webview.asWebviewUri()`, `webview.postMessage()`
  - Handles: HTML generation, React app loading, extension ↔ webview communication
  - Connects to: [`html.ts`](src/services/html.ts), receives messages from React app

- **[`src/services/languageModel.ts`](src/services/languageModel.ts)** - VS Code Language Model API integration
  - Uses: `vscode.lm.selectChatModels()`, `model.sendRequest()`, streaming via `response.text`
  - Handles: Model discovery, AI requests with proper error handling
  - Provides: Available models list, streaming responses to extension

- **[`src/services/html.ts`](src/services/html.ts)** - Secure HTML document generator
  - Uses: Content Security Policy, nonce-based script loading
  - Handles: Webview HTML structure, CSS embedding, React mounting point
  - Provides: Complete HTML document with `<div id="root">` for React

### **Webview App (Browser Environment)**
- **[`src/webview/index.tsx`](src/webview/index.tsx)** - React entry point
  - Uses: `ReactDOM.createRoot()`, finds `#root` element from HTML
  - Handles: React app initialization and mounting
  - Connects to: [`App.tsx`](src/webview/App.tsx)

- **[`src/webview/App.tsx`](src/webview/App.tsx)** - Root React component
  - Provides: [`VSCodeProvider`](src/webview/context/VSCodeContext.tsx) context wrapper
  - Renders: Main [`Chat`](src/webview/components/chat/Chat.tsx) interface

- **[`src/webview/context/VSCodeContext.tsx`](src/webview/context/VSCodeContext.tsx)** - Extension communication layer
  - Uses: `window.acquireVsCodeApi()`, `vscode.postMessage()`, `window.addEventListener('message')`
  - Handles: Bidirectional messaging between React and extension
  - Provides: `postMessage()` and `onMessage()` to React components

- **[`src/webview/hooks/useChat.ts`](src/webview/hooks/useChat.ts)** - Chat state management
  - Uses: VSCodeContext for messaging
  - Handles: Message history, streaming responses, loading states
  - Connects to: Chat components for UI updates

### **Build System**
- **[`esbuild.js`](esbuild.js)** - Dual build configuration
  - **Extension bundle**: `src/extension.ts` → `dist/extension.js` (Node.js/CommonJS)
  - **Webview bundle**: `src/webview/index.tsx` → `dist/media/webview.js` (Browser/IIFE)
  - **Features**: React JSX transform, file watching, media copying

- **[`.vscode/tasks.json`](.vscode/tasks.json)** - Development workflow
  - **`watch`**: Parallel TypeScript checking + esbuild bundling
  - **Background tasks**: Continuous rebuilding on file changes

## 🔄 Message Flow Architecture

### **Chat Request Flow**
```
User Input → ChatInput → useChat → VSCodeContext → ChatViewProvider 
    ↓
extension.ts → languageModel.ts → VS Code LM API → Streaming Response
    ↓
ChatViewProvider → VSCodeContext → useChat → Chat UI Update
```

### **Key Message Types** ([`src/types/chat.ts`](src/types/chat.ts))
```typescript
// Webview → Extension
interface ChatAskMessage {
  type: 'chat:ask';
  prompt: string;
  mode: 'agent' | 'ask';  // agent = code changes, ask = Q&A
  model: string;
}

// Extension → Webview  
interface ChatStreamMessage {
  type: 'chat:stream';
  token: string;  // Real-time AI response tokens
}

interface ChatCodeAppliedMessage {
  type: 'chat:code-applied';  // After code is applied to file
  fileName: string;
  linesAdded: number;
  linesDeleted: number;
}
```

## 🛠️ VS Code APIs Usage

| API | Purpose | File |
|-----|---------|------|
| `vscode.window.registerWebviewViewProvider()` | Create sidebar panel | [`extension.ts`](src/extension.ts) |
| `vscode.lm.selectChatModels()` | Discover available models | [`languageModel.ts`](src/services/languageModel.ts) |
| `model.sendRequest()` | Send AI requests | [`languageModel.ts`](src/services/languageModel.ts) |
| `vscode.TextEditor.edit()` | Apply code changes | [`extension.ts`](src/extension.ts) |
| `vscode.commands.executeCommand('vscode.diff')` | Show diff view | [`extension.ts`](src/extension.ts) |
| `vscode.scm.createSourceControl()` | Diff gutter indicators | [`extension.ts`](src/extension.ts) |
| `vscode.window.createStatusBarItem()` | Diff action buttons | [`extension.ts`](src/extension.ts) |
| `webview.asWebviewUri()` | Secure resource URIs | [`ChatViewProvider.ts`](src/panels/ChatViewProvider.ts) |
| `window.acquireVsCodeApi()` | Webview communication | [`VSCodeContext.tsx`](src/webview/context/VSCodeContext.tsx) |

## 🎯 Core Features

### **AI Integration**
- **Model Support**: VS Code Language Models (GPT-4o, Claude, etc.)
- **Streaming**: Real-time token-by-token responses
- **Context**: Includes current file content in prompts
- **Modes**: Agent (code changes) vs Ask (Q&A)

### **Code Application & Diff**
- **Auto-apply**: Extracts code from AI responses and applies to files
- **Diff View**: Side-by-side comparison using VS Code's native diff editor
- **Gutter Indicators**: Green/red line markers showing changes
- **Actions**: Accept/Reject changes via status bar buttons

### **Security**
- **Webview Sandbox**: CSP protection, nonce-based script loading
- **No External APIs**: Uses only VS Code's built-in Language Model API
- **Secure Storage**: API keys stored in VS Code's secret storage

## 🚀 Development Setup

```bash
# Install dependencies
npm install

# Start development (runs both TypeScript compiler and bundler)
npm run watch

# Or run separately:
npm run watch:tsc     # TypeScript type checking
npm run watch:esbuild # JavaScript bundling

# Launch Extension Development Host
# Press F5 in VS Code
```

### **Development Workflow**
1. **Save any file** → Triggers rebuild (< 100ms)
2. **TypeScript errors** → Problems panel
3. **Extension reload** → `Ctrl+R` in development host
4. **Debug extension** → Set breakpoints in TypeScript files
5. **Debug webview** → `Ctrl+Shift+I` in chat panel

## 📦 Key Dependencies

- **Runtime**: `react`, `react-dom`, `react-icons`
- **Build**: `esbuild`, `typescript`, `eslint`
- **VS Code**: `@types/vscode` (^1.88.0 for Language Model API)

## 🔧 Extension Points

### **Adding New Message Types**
1. Define in [`types/chat.ts`](src/types/chat.ts)
2. Handle in [`extension.ts`](src/extension.ts) message handler
3. Send from React via [`useChat.ts`](src/webview/hooks/useChat.ts)

### **Adding New Commands**
1. Register in [`package.json`](package.json) `contributes.commands`
2. Implement in [`extension.ts`](src/extension.ts) `activate()`
3. Add to `context.subscriptions`