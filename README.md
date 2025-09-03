# PayPilot Extension - Complete Developer Guide

An AI-powered coding assistant VS Code extension with a chat interface that provides intelligent code suggestions and can apply changes directly to your codebase.

## 🛠️ Development Workflow & Build System

### How the Build System Works

This extension uses a sophisticated multi-process build system that coordinates TypeScript compilation and JavaScript bundling for optimal development experience.

#### 📁 Key Configuration Files

**`.vscode/tasks.json`** - The Build Orchestrator
```jsonc
{
  "tasks": [
    {
      "label": "watch",                    // Main development task
      "dependsOn": [
        "npm: watch:tsc",                  // TypeScript type checking
        "npm: watch:esbuild"               // JavaScript bundling
      ]
    }
  ]
}
```

**`package.json`** - Script Definitions
```json
{
  "scripts": {
    "watch:tsc": "tsc -watch -p ./",      // Continuous type checking
    "watch:esbuild": "node esbuild.js --watch"  // Continuous bundling
  }
}
```

**`esbuild.js`** - The Bundler Configuration
```javascript
// Creates TWO separate builds:
// 1. Extension (Node.js): src/extension.ts → dist/extension.js
// 2. Webview (Browser): src/webview/index.tsx → dist/media/webview.js
```

### 🔄 Development Process Flow

When you press **`F5`** or **`Ctrl+Shift+B`**:

```
1. VS Code reads .vscode/tasks.json
   ↓
2. Runs "watch" task 
   ↓
3. Starts TWO processes in parallel:

   Process A: TypeScript Compiler (tsc)
   ┌─────────────────────────────────┐
   │ • Reads tsconfig.json           │
   │ • Continuous type checking      │
   │ • Error reporting               │
   │ • IntelliSense support          │
   │ • No file output (just types)   │
   └─────────────────────────────────┘

   Process B: esbuild Bundler
   ┌─────────────────────────────────┐
   │ • Bundles src/extension.ts      │
   │ • Bundles src/webview/index.tsx │
   │ • Transforms React JSX          │
   │ • Copies media files            │
   │ • Outputs to dist/ folder       │
   └─────────────────────────────────┘
```

### 📦 File Transform Pipeline

```
SOURCE FILES                    →    BUNDLED OUTPUT
├── src/extension.ts           →    dist/extension.js (Node.js)
├── src/webview/index.tsx      →    dist/media/webview.js (Browser)
├── src/media/global.css       →    dist/media/global.css
└── package.json               →    Extension metadata

DUAL ENVIRONMENT ARCHITECTURE:
┌─ Extension (Node.js) ────────┐    ┌─ Webview (Browser) ──────────┐
│ • VS Code APIs              │    │ • React Components           │
│ • File system access        │    │ • DOM manipulation           │
│ • API key management        │    │ • User interface             │
│ • Diff generation           │    │ • Chat interactions          │
└──────────────────────────────┘    └──────────────────────────────┘
                ↕ postMessage Communication ↕
```

### ⚡ Live Development Features

**Instant Feedback Loop:**
1. **Save any file** → Triggers rebuild (< 100ms)
2. **TypeScript errors** → Appear immediately in Problems panel
3. **Extension reload** → Automatic via VS Code
4. **React hot reload** → UI updates without losing state

**Background Processes:**
- **`isBackground: true`** - Tasks run continuously
- **File watching** - Detects changes automatically
- **Incremental builds** - Only rebuilds changed files

### 🎯 Why This Architecture?

**Separation of Concerns:**
- **tsc**: Excellent TypeScript error reporting & IntelliSense
- **esbuild**: Ultra-fast bundling (10-100x faster than webpack)
- **Dual builds**: Extension (Node.js) + Webview (Browser) environments

**Development Speed:**
- **Millisecond rebuilds** with esbuild
- **Parallel processing** with tsc + esbuild
- **No build tools conflicts** - each does what it's best at

## 🎯 What This Extension Does

PayPilot is a VS Code extension that:
- Creates a **chat sidebar panel** for AI conversations
- Provides **real-time streaming responses** from DeepSeek AI
- Can **analyze your current code** and make intelligent suggestions
- **Applies AI-generated code** directly to your files with diff visualization
- Shows **before/after diffs** using VS Code's native diff viewer
- Manages **API keys securely** using VS Code's secret storage

## 🏗️ Complete Architecture Overview

This extension follows VS Code's modern extension architecture with clear separation between:

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                   │ ← Node.js Environment
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐│
│  │   extension.ts  │←→│ ChatViewProvider │←→│  Services   ││
│  │  (Entry Point)  │  │   (Bridge)       │  │ (API/Keys)  ││
│  └─────────────────┘  └──────────────────┘  └─────────────┘│
└─────────────────────────────────────────────────────────────┘
                              ↕ postMessage API
┌─────────────────────────────────────────────────────────────┐
│                      Webview (Browser)                     │ ← Sandboxed React App
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐│
│  │   React App     │←→│   VSCodeContext  │←→│ Components  ││
│  │  (UI Layer)     │  │  (Communication) │  │ (Chat UI)   ││
│  └─────────────────┘  └──────────────────┘  └─────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Complete Extension Lifecycle

### 1. Extension Activation ([`src/extension.ts`](src/extension.ts))

When VS Code loads the extension, the [`activate`](src/extension.ts) function runs:

```typescript
// Register the webview provider with VS Code
const chatProvider = new ChatViewProvider(context);
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider('paypilotChatView', chatProvider, { 
    webviewOptions: { retainContextWhenHidden: true }
  })
);
```

**VS Code APIs Used:**
- [`vscode.window.registerWebviewViewProvider()`](https://code.visualstudio.com/api/references/vscode-api#window.registerWebviewViewProvider) - Creates the sidebar panel
- [`vscode.commands.registerCommand()`](https://code.visualstudio.com/api/references/vscode-api#commands.registerCommand) - Registers commands like "PayPilot: Open Chat"
- [`vscode.ExtensionContext`](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext) - Provides extension lifecycle and storage

### 2. Webview Creation ([`src/panels/ChatViewProvider.ts`](src/panels/ChatViewProvider.ts))

When the user opens the PayPilot sidebar, VS Code calls [`resolveWebviewView()`](src/panels/ChatViewProvider.ts):

```typescript
resolveWebviewView(webviewView: vscode.WebviewView) {
  this._view = webviewView;
  const webview = webviewView.webview;

  // Configure security and permissions
  webview.options = {
    enableScripts: true,                    // Allow React to run
    localResourceRoots: [this.context.extensionUri]  // Security boundary
  };

  // Generate secure URIs for React bundle
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'webview.js')
  );

  // Create HTML container for React app
  webview.html = getWebviewHtml(webview, this.context.extensionUri, { scriptUri, styleUri });
}
```

**VS Code APIs Used:**
- [`vscode.WebviewView`](https://code.visualstudio.com/api/references/vscode-api#WebviewView) - The container for our React app
- [`webview.asWebviewUri()`](https://code.visualstudio.com/api/references/vscode-api#Webview.asWebviewUri) - Creates secure URIs for webview resources
- [`webview.options`](https://code.visualstudio.com/api/references/vscode-api#WebviewOptions) - Configures security and permissions

### 3. HTML Generation ([`src/services/html.ts`](src/services/html.ts))

The [`getWebviewHtml()`](src/services/html.ts) function creates a complete HTML document:

```typescript
export function getWebviewHtml(webview: vscode.Webview, extUri: vscode.Uri, uris: { scriptUri: vscode.Uri; styleUri: vscode.Uri }) {
  const nonce = getNonce();
  
  // Security headers prevent XSS attacks
  const csp = [
    "default-src 'none'",
    "img-src 'self' data:",
    "style-src 'unsafe-inline' 'self'",
    `script-src 'nonce-${nonce}'`
  ].join('; ');

  return `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>${cssContent}</style>  <!-- Embedded CSS for reliability -->
</head>
<body>
  <div id="root"></div>  <!-- React mounting point -->
  <script nonce="${nonce}" src="${uris.scriptUri}"></script>  <!-- React bundle -->
</body>
</html>`;
}
```

**Key Features:**
- **Content Security Policy (CSP)** prevents XSS attacks
- **Nonce-based script loading** allows only authorized JavaScript
- **Embedded CSS** ensures styling works in webview environment
- **React mounting point** (`#root`) where our app will render

### 4. React App Bootstrap ([`src/webview/index.tsx`](src/webview/index.tsx))

When the webview loads, the bundled React app executes:

```typescript
// Find the mounting point created by html.ts
const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element not found. HTML structure mismatch.');
}

// Create React 18 root and render the app
const root = createRoot(container);
root.render(<App />);
```

**React Integration:**
- Uses **React 18's `createRoot()`** for concurrent features
- **Error handling** for HTML/React integration issues
- **Direct DOM mounting** to the element created by `html.ts`

### 5. App Structure Setup ([`src/webview/App.tsx`](src/webview/App.tsx))

The root React component establishes the application architecture:

```typescript
export const App: React.FC = () => {
  return (
    <VSCodeProvider>  {/* Enables VS Code communication */}
      <div className="app">
        <Chat />  {/* Main chat interface */}
      </div>
    </VSCodeProvider>
  );
};
```

### 6. Communication Bridge ([`src/webview/context/VSCodeContext.tsx`](src/webview/context/VSCodeContext.tsx))

The [`VSCodeProvider`](src/webview/context/VSCodeContext.tsx) creates the communication layer:

```typescript
export const VSCodeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Acquire VS Code's webview API
  const [vscode] = useState(() => window.acquireVsCodeApi());
  
  // Message listener management
  const [messageListeners] = useState<Set<(message: ExtensionToWebviewMessage) => void>>(new Set());

  // Send messages to extension
  const postMessage = useCallback((message: WebviewToExtensionMessage) => {
    vscode.postMessage(message);
  }, [vscode]);

  // Register message listeners
  const onMessage = useCallback((callback: (message: ExtensionToWebviewMessage) => void) => {
    messageListeners.add(callback);
    return () => messageListeners.delete(callback);  // Cleanup function
  }, [messageListeners]);

  // Global message listener
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ExtensionToWebviewMessage;
      messageListeners.forEach(listener => listener(message));
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [messageListeners]);
```

**VS Code Webview APIs Used:**
- [`window.acquireVsCodeApi()`](https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing) - Gets VS Code communication interface
- [`vscode.postMessage()`](https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing) - Sends messages to extension
- [`window.addEventListener('message')`](https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing) - Receives messages from extension

## 🔄 Complete Message Flow Architecture

### Chat Request Flow

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   ChatInput     │───→│    useChat      │───→│  VSCodeContext  │
│ (User types)    │    │ (sendMessage)   │    │ (postMessage)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   DeepSeek API  │←───│   extension.ts  │←───│ ChatViewProvider│
│ (AI Response)   │    │ (Message Handler)│    │ (onDidReceiveMessage)│
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 1. User Input ([`src/webview/components/chat/ChatInput.tsx`](src/webview/components/chat/ChatInput.tsx))

```typescript
const handleSubmit = () => {
  sendMessage(input);  // Calls useChat hook
};
```

### 2. State Management ([`src/webview/hooks/useChat.ts`](src/webview/hooks/useChat.ts))

```typescript
const sendMessage = useCallback((prompt: string) => {
  // Send to extension via VSCode context
  postMessage({
    type: 'chat:ask',
    prompt: prompt,
    mode: mode  // 'ask' or 'agent'
  });
}, [postMessage, mode]);
```

### 3. Extension Message Handling ([`src/extension.ts`](src/extension.ts))

```typescript
chatProvider.onMessage(async (msg: any, panel: any) => {
  if (msg?.type === 'chat:ask') {
    // Get API key from secure storage
    const { key: apiKey } = await resolveDeepSeekApiKey(context);
    
    // Get current code context
    const editor = vscode.window.activeTextEditor;
    let editorContext = '';
    if (editor) {
      editorContext = editor.document.getText();  // Current file content
    }

    // Call AI API with streaming
    await askDeepSeek({
      apiKey,
      prompt: msg.prompt,
      context: editorContext,
      onToken: (token) => {
        // Stream response back to UI
        panel.postMessage({ type: 'chat:stream', token });
      },
      onDone: (fullResponse) => {
        panel.postMessage({ type: 'chat:done', text: fullResponse });
      }
    });
  }
});
```

**VS Code APIs Used in Message Handler:**
- [`vscode.window.activeTextEditor`](https://code.visualstudio.com/api/references/vscode-api#window.activeTextEditor) - Gets current file
- [`vscode.TextDocument.getText()`](https://code.visualstudio.com/api/references/vscode-api#TextDocument.getText) - Reads file content
- [`panel.postMessage()`](https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing) - Sends response to webview

### 4. AI Service Integration ([`src/services/deepseek.ts`](src/services/deepseek.ts))

```typescript
export async function askDeepSeek(args: AskArgs): Promise<void> {
  const response = await fetch(`${args.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: args.model,
      messages: [{ role: 'user', content: args.prompt }],
      stream: true  // Enable streaming
    })
  });

  // Process streaming response
  const reader = response.body?.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    
    // Parse SSE format and extract tokens
    const token = parseStreamToken(value);
    args.onToken(token);  // Send to extension
  }
}
```

### 5. Streaming Response Back to UI ([`src/webview/hooks/useChat.ts`](src/webview/hooks/useChat.ts))

```typescript
useEffect(() => {
  return onMessage((message) => {
    if (message.type === 'chat:stream') {
      // Update the last message with new token
      setState(prev => ({
        ...prev,
        messages: prev.messages.map((msg, idx) => 
          idx === prev.messages.length - 1 
            ? { ...msg, content: msg.content + message.token }
            : msg
        )
      }));
    }
  });
}, [onMessage]);
```

## 🔧 Code Application & Diff System

### Code Detection and Application

When the AI responds with code in agent mode, the extension automatically applies it:

```typescript
// In extension.ts message handler
if (mode === 'agent' && editor) {
  // Extract code from markdown blocks
  const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/;
  const match = fullResponse.match(codeBlockRegex);
  
  if (match && match[1]) {
    const newContent = match[1].trim();
    await applyChangesWithVSCodeDiff(newContent);
  }
}
```

### VS Code Diff Integration ([`src/extension.ts`](src/extension.ts))

The extension uses VS Code's native diff system:

```typescript
async function applyChangesWithVSCodeDiff(newContent: string) {
  const editor = vscode.window.activeTextEditor;
  
  // Store original content for diff
  originalContent = editor.document.getText();
  currentDocumentUri = editor.document.uri;

  // Apply changes to editor
  await editor.edit(editBuilder => {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    editBuilder.replace(fullRange, newContent);
  });

  // Set up diff providers
  setupDiffProviders();
  showDiffActionButtons();
}
```

**VS Code APIs Used for Diff:**
- [`vscode.TextEditor.edit()`](https://code.visualstudio.com/api/references/vscode-api#TextEditor.edit) - Modifies file content
- [`vscode.scm.createSourceControl()`](https://code.visualstudio.com/api/references/vscode-api#scm.createSourceControl) - Creates SCM integration
- [`vscode.workspace.registerTextDocumentContentProvider()`](https://code.visualstudio.com/api/references/vscode-api#workspace.registerTextDocumentContentProvider) - Provides original content for diff
- [`vscode.window.createStatusBarItem()`](https://code.visualstudio.com/api/references/vscode-api#window.createStatusBarItem) - Shows action buttons

### Custom Content Providers

```typescript
class OriginalContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return originalContent;  // Provides "before" content for diff
  }
}

class PayPilotQuickDiffProvider implements vscode.QuickDiffProvider {
  provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (currentDocumentUri && uri.toString() === currentDocumentUri.toString()) {
      return vscode.Uri.parse(`paypilot-original:${uri.path}`);
    }
    return undefined;
  }
}
```

**VS Code APIs Used:**
- [`vscode.TextDocumentContentProvider`](https://code.visualstudio.com/api/references/vscode-api#TextDocumentContentProvider) - Provides virtual document content
- [`vscode.QuickDiffProvider`](https://code.visualstudio.com/api/references/vscode-api#QuickDiffProvider) - Shows diff indicators in gutter

### Side-by-Side Diff View

```typescript
async function openSideBySideDiff() {
  const originalUri = vscode.Uri.parse(`paypilot-original:${currentDocumentUri.path}`);
  
  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,           // Left side: original content
    currentDocumentUri,    // Right side: modified content
    'PayPilot Changes (Original ↔ Modified)',
    { viewColumn: vscode.ViewColumn.Beside }
  );
}
```

**VS Code APIs Used:**
- [`vscode.commands.executeCommand('vscode.diff')`](https://code.visualstudio.com/api/references/vscode-api#commands.executeCommand) - Opens built-in diff editor

## 🔐 Security & API Key Management

### Secure Storage ([`src/services/apiKeyManager.ts`](src/services/apiKeyManager.ts))

```typescript
export class ApiKeyManager {
  async setApiKey(service: string, apiKey: string): Promise<void> {
    await this.context.secrets.store(`${service}-api-key`, apiKey);
  }

  async getApiKey(service: string): Promise<string | undefined> {
    return await this.context.secrets.get(`${service}-api-key`);
  }
}
```

**VS Code APIs Used:**
- [`vscode.ExtensionContext.secrets`](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.secrets) - Secure credential storage
- [`vscode.SecretStorage.store()`](https://code.visualstudio.com/api/references/vscode-api#SecretStorage.store) - Encrypts and stores secrets
- [`vscode.SecretStorage.get()`](https://code.visualstudio.com/api/references/vscode-api#SecretStorage.get) - Retrieves encrypted secrets

### Configuration Management

```typescript
// Get configuration values
const cfg = vscode.workspace.getConfiguration('paypilot');
const model = cfg.get('model') || 'deepseek-chat';
const apiBase = cfg.get('apiBase') || 'https://api.deepseek.com';
const maxContextChars = cfg.get('maxContextChars') || 12000;
```

**VS Code APIs Used:**
- [`vscode.workspace.getConfiguration()`](https://code.visualstudio.com/api/references/vscode-api#workspace.getConfiguration) - Reads extension settings

## 🏗️ Build System & Bundling

### ESBuild Configuration ([`esbuild.js`](esbuild.js))

The extension uses ESBuild for fast, efficient bundling:

```javascript
// Extension bundle (Node.js)
const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',                    // CommonJS for Node.js
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode'],             // VS Code API is external
});

// React app bundle (Browser)
const webviewCtx = await esbuild.context({
  entryPoints: ['src/webview/index.tsx'],
  bundle: true,
  format: 'iife',                   // Immediate function for browser
  platform: 'browser',
  outfile: 'dist/media/webview.js',
  jsx: 'automatic',                 // React 18 JSX transform
  jsxImportSource: 'react'
});
```

### Package.json Configuration

```json
{
  "main": "./dist/extension.js",     // Extension entry point
  "contributes": {
    "views": {
      "paypilotSidebar": [
        {
          "id": "paypilotChatView",  // Must match registerWebviewViewProvider
          "name": "Chat",
          "type": "webview"
        }
      ]
    },
    "viewsContainers": {
      "activitybar": [
        {
          "id": "paypilotSidebar",
          "title": "PayPilot",
          "icon": "$(credit-card)"
        }
      ]
    }
  }
}
```

## 🔍 Type Safety & Communication Contracts

### Message Type Definitions ([`src/types/chat.ts`](src/types/chat.ts))

```typescript
// Messages from React to Extension
export interface ChatAskMessage {
  type: 'chat:ask';
  prompt: string;
  mode: 'agent' | 'ask';
}

export interface ChatStopMessage {
  type: 'chat:stop';
}

export type WebviewToExtensionMessage = ChatAskMessage | ChatStopMessage;

// Messages from Extension to React
export interface ChatStreamMessage {
  type: 'chat:stream';
  token: string;
}

export interface ChatDoneMessage {
  type: 'chat:done';
  text: string;
}

export type ExtensionToWebviewMessage = ChatStreamMessage | ChatDoneMessage;
```

This type system ensures:
- **Compile-time safety** for all message passing
- **IntelliSense support** for developers
- **Runtime error prevention** through TypeScript validation

## 🚀 Development Workflow

### Setting Up Development Environment

```bash
# Install dependencies
npm install

# Start TypeScript compiler in watch mode
npm run watch:tsc

# Start ESBuild bundler in watch mode
npm run watch:esbuild

# Open Extension Development Host
# Press F5 in VS Code to launch development instance
```

### Development Commands

| Command | Purpose |
|---------|---------|
| `npm run watch:tsc` | TypeScript compilation in watch mode |
| `npm run watch:esbuild` | Bundle React and extension code |
| `npm run build` | Production build |
| `F5` | Launch Extension Development Host |
| `Ctrl+R` | Reload extension in development host |

### Debugging

#### Extension Code (Node.js)
- Set breakpoints in TypeScript files
- Use VS Code's built-in debugger
- Check "Extension Host" output panel for logs

#### React Code (Browser)
- Open webview Developer Tools (`Ctrl+Shift+I`)
- Use browser debugging tools
- React components appear in Elements tab

## 🛠️ Adding New Features

### Adding a New Message Type

1. **Define in types** ([`src/types/chat.ts`](src/types/chat.ts)):
```typescript
export interface NewFeatureMessage {
  type: 'feature:new';
  data: string;
}
```

2. **Handle in extension** ([`src/extension.ts`](src/extension.ts)):
```typescript
chatProvider.onMessage(async (msg: any, panel: any) => {
  if (msg?.type === 'feature:new') {
    // Handle the new feature
    panel.postMessage({ type: 'feature:response', result: 'success' });
  }
});
```

3. **Send from React** ([`src/webview/hooks/useChat.ts`](src/webview/hooks/useChat.ts)):
```typescript
const triggerNewFeature = useCallback((data: string) => {
  postMessage({ type: 'feature:new', data });
}, [postMessage]);
```

### Adding a New UI Component

1. **Create component** in [`src/webview/components/`](src/webview/components/)
2. **Add styles** to [`src/media/global.css`](src/media/global.css)
3. **Import and use** in parent components
4. **Test** in both light and dark themes

## 📋 Key VS Code Extension APIs Used

| API | Purpose | Location Used |
|-----|---------|---------------|
| `vscode.window.registerWebviewViewProvider()` | Creates sidebar panel | [`extension.ts`](src/extension.ts) |
| `vscode.WebviewView` | Container for React app | [`ChatViewProvider.ts`](src/panels/ChatViewProvider.ts) |
| `webview.asWebviewUri()` | Secure resource URIs | [`ChatViewProvider.ts`](src/panels/ChatViewProvider.ts) |
| `vscode.TextEditor.edit()` | Modify file content | [`extension.ts`](src/extension.ts) |
| `vscode.commands.executeCommand()` | Trigger VS Code commands | [`extension.ts`](src/extension.ts) |
| `vscode.scm.createSourceControl()` | SCM integration for diffs | [`extension.ts`](src/extension.ts) |
| `vscode.workspace.registerTextDocumentContentProvider()` | Virtual documents | [`extension.ts`](src/extension.ts) |
| `vscode.window.createStatusBarItem()` | Status bar buttons | [`extension.ts`](src/extension.ts) |
| `vscode.ExtensionContext.secrets` | Secure API key storage | [`apiKeyManager.ts`](src/services/apiKeyManager.ts) |
| `vscode.workspace.getConfiguration()` | Read extension settings | [`extension.ts`](src/extension.ts) |

## 🎯 Architecture Benefits

✅ **Security**: Sandboxed webview with CSP protection  
✅ **Performance**: Fast builds with ESBuild, efficient React rendering  
✅ **Type Safety**: Full TypeScript coverage prevents runtime errors  
✅ **Maintainability**: Clear separation of concerns, modular design  
✅ **Scalability**: Easy to add new features and message types  
✅ **Developer Experience**: Hot reload, debugging tools, comprehensive error handling  

This architecture provides a solid foundation for building complex VS Code extensions with modern web technologies while maintaining security and performance standards.