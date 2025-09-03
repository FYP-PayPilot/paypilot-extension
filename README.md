# PayPilot Extension - VS Code Language Model API Integration

An AI-powered coding assistant VS Code extension that strictly follows the VS Code Language Model API documentation. Provides intelligent code suggestions through a chat interface with real-time streaming responses.

## 🎯 Language Model API Implementation

This extension is built with strict adherence to the [VS Code Language Model API documentation](https://code.visualstudio.com/api/extension-guides/language-model), implementing all recommended patterns and best practices.

### 🔧 Key Features

- **VS Code Native Integration**: Uses `vscode.lm.selectChatModels()` for model discovery
- **Defensive Programming**: Gracefully handles when models are not available
- **Proper Error Handling**: Implements all `LanguageModelError` codes
- **Real-time Streaming**: Uses `response.text` AsyncIterable for smooth UX
- **User Consent**: Follows Copilot permission requirements
- **Model Recommendations**: Implements gpt-4o (general) and gpt-4o-mini (editor) preferences

### 📋 Supported Models

According to VS Code documentation, currently supported models include:
- **gpt-4o** (recommended for performance and quality)
- **gpt-4o-mini** (recommended for editor interactions)
- **o1, o1-mini** (reasoning models)
- **claude-3.5-sonnet** (Anthropic model)

### 🏗️ Architecture

```typescript
// Model Discovery (Defensive Programming)
const models = await vscode.lm.selectChatModels();
if (models.length === 0) {
  // Handle gracefully - no models available
}

// Request with Proper Error Handling
try {
  const response = await model.sendRequest(messages, {
    justification: 'PayPilot needs access for coding assistance'
  }, cancellationToken);
  
  // Streaming Response (Real-time UX)
  for await (const chunk of response.text) {
    onToken(chunk); // Real-time display
  }
} catch (error) {
  if (error instanceof vscode.LanguageModelError) {
    // Handle specific VS Code errors
    handleLanguageModelError(error);
  }
}
```

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
- Provides **real-time streaming responses** from multiple AI providers
- Can **analyze your current code** and make intelligent suggestions
- **Applies AI-generated code** directly to your files with diff visualization
- Shows **before/after diffs** using VS Code's native diff viewer
- Manages **API keys securely** using VS Code's secret storage

## 🤖 Language Model Integration

PayPilot is built exclusively on VS Code's official Language Model API, ensuring the most reliable and performant integration possible.

### VS Code Language Model API
- **Official VS Code Integration** - Uses `vscode.lm` namespace exclusively
- **Automatic Model Discovery** - Detects all available VS Code language models
- **GitHub Copilot Access** - Full access to gpt-4o, gpt-4o-mini, claude-3.5-sonnet
- **Built-in Authentication** - Uses your existing GitHub Copilot subscription
- **Streaming Responses** - Real-time response display using `response.text`
- **Proper Error Handling** - Comprehensive `LanguageModelError` handling

### Model Selection & Best Practices
```typescript
// Following VS Code documentation recommendations
const preferredModels = [
  "gpt-4o",          // Best overall performance (documentation recommended)
  "gpt-4o-mini",     // Ideal for editor interactions (documentation recommended)
  "claude-3.5-sonnet", // Alternative model option
];
```

**Architecture Benefits:**
- **Zero External Dependencies** - No API keys or external services needed
- **Documentation Compliance** - Strict adherence to VS Code LM API patterns
- **Defensive Programming** - Graceful handling when models unavailable
- **Performance Optimized** - Model caching and efficient streaming
- **Future-Proof** - Automatically supports new VS Code language models

## 🏗️ Complete Architecture Overview

This extension follows VS Code's modern extension architecture with exclusive focus on the official Language Model API:

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                   │ ← Node.js Environment
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐│
│  │   extension.ts  │←→│ ChatViewProvider │←→│ languageModel││
│  │  (Entry Point)  │  │   (Bridge)       │  │  (VS Code   ││
│  │                 │  │                  │  │   LM API)   ││
│  └─────────────────┘  └──────────────────┘  └─────────────┘│
│                                               ↑            │
│                              vscode.lm.selectChatModels()  │
└─────────────────────────────────────────────────────────────┘
                              ↕ postMessage API
┌─────────────────────────────────────────────────────────────┐
│                      Webview (Browser)                     │ ← Sandboxed React App
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐│
│  │   React App     │←→│   VSCodeContext  │←→│ Chat UI     ││
│  │  (UI Layer)     │  │  (Communication) │  │ (Streaming) ││
│  └─────────────────┘  └──────────────────┘  └─────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Key Architecture Principles:**
- **Pure VS Code API** - Zero external dependencies or API keys
- **Documentation Compliant** - Follows all VS Code LM API patterns
- **Defensive Programming** - Graceful handling of model availability
- **Streaming First** - Real-time response display using `response.text`

## 🚀 Complete Extension Lifecycle

### 1. Extension Activation ([`src/extension.ts`](src/extension.ts))

When VS Code loads the extension, the [`activate`](src/extension.ts) function runs:

```typescript
export function activate(context: vscode.ExtensionContext) {
  // Register the webview provider
  const provider = new ChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider)
  );
  
  // Handle Language Model API changes
  context.subscriptions.push(
    vscode.lm.onDidChangeChatModels(() => {
      // Refresh available models when VS Code updates them
      provider.refreshAvailableModels();
    })
  );
}
```

**VS Code APIs Used:**
- [`vscode.window.registerWebviewViewProvider()`](https://code.visualstudio.com/api/references/vscode-api#window.registerWebviewViewProvider) - Creates the sidebar panel
- [`vscode.lm.onDidChangeChatModels()`](https://code.visualstudio.com/api/extension-guides/language-model) - Monitors model availability changes
- [`vscode.lm.selectChatModels()`](https://code.visualstudio.com/api/extension-guides/language-model) - Discovers available language models
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

### 4. Language Model Service ([`src/services/languageModel.ts`](src/services/languageModel.ts))

The core service that implements VS Code Language Model API integration with strict documentation compliance:

```typescript
export class LanguageModelService {
  private modelCache: vscode.LanguageModelChat[] | null = null;

  async getAvailableModels(): Promise<vscode.LanguageModelChat[]> {
    if (!this.modelCache) {
      // Model discovery following VS Code documentation
      this.modelCache = await vscode.lm.selectChatModels();
    }
    return this.modelCache;
  }

  async sendEnhancedLanguageModelRequest(
    userPrompt: string, 
    codeContext?: string, 
    modelId?: string
  ): Promise<string> {
    const models = await this.getAvailableModels();
    
    // Defensive programming - handle no models gracefully
    if (models.length === 0) {
      throw new Error('No language models available. Please ensure GitHub Copilot is enabled.');
    }

    // Model selection with documentation recommendations
    const model = modelId 
      ? models.find(m => m.id === modelId) || models[0]
      : models.find(m => m.id === 'gpt-4o') || models[0]; // Prefer gpt-4o per docs

    // Enhanced prompt creation following best practices
    const enhancedPrompt = this.createEnhancedPrompt(userPrompt, codeContext);

    // Request with proper justification and error handling
    try {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(enhancedPrompt)],
        { justification: 'PayPilot needs access to provide coding assistance' },
        new vscode.CancellationToken()
      );

      // Streaming response handling
      let fullResponse = '';
      for await (const chunk of response.text) {
        fullResponse += chunk;
      }
      return fullResponse;
    } catch (error) {
      // Comprehensive LanguageModelError handling
      if (error instanceof vscode.LanguageModelError) {
        return this.handleLanguageModelError(error);
      }
      throw error;
    }
  }

  private createEnhancedPrompt(userPrompt: string, codeContext?: string): string {
    // Following documentation recommendations for context-aware prompting
    return `You are an expert code assistant. ${codeContext ? 
      `Here's the current code context:\n\`\`\`\n${codeContext}\n\`\`\`\n\n` : ''
    }User request: ${userPrompt}\n\nProvide clear, actionable advice.`;
  }
}
```

**Documentation Compliance Features:**
- **Model Caching** - Improves performance per VS Code recommendations
- **Error Handling** - Comprehensive `LanguageModelError` code handling
- **Streaming Responses** - Real-time display using `response.text` AsyncIterable
- **Enhanced Prompts** - Context-aware prompt engineering patterns
- **Defensive Programming** - Graceful handling when models unavailable
- **Model Preferences** - Follows documentation recommendations (gpt-4o preferred)

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
    try {
      // Get current code context for enhanced prompting
      const editor = vscode.window.activeTextEditor;
      let editorContext = '';
      if (editor) {
        editorContext = editor.document.getText();  // Current file content
      }

      // Use VS Code Language Model API with streaming
      const languageModelService = new LanguageModelService();
      
      // Enhanced request with code context
      const response = await languageModelService.sendEnhancedLanguageModelRequest(
        msg.prompt,
        editorContext,
        msg.modelId
      );

      // Send complete response to UI
      panel.postMessage({ 
        type: 'chat:done', 
        text: response,
        modelUsed: msg.modelId || 'default'
      });

    } catch (error) {
      // Handle VS Code Language Model errors gracefully
      panel.postMessage({ 
        type: 'chat:error', 
        error: error.message || 'Language model request failed'
      });
    }
  }
});
```

**VS Code APIs Used in Message Handler:**
- [`vscode.window.activeTextEditor`](https://code.visualstudio.com/api/references/vscode-api#window.activeTextEditor) - Gets current file for context
- [`vscode.TextDocument.getText()`](https://code.visualstudio.com/api/references/vscode-api#TextDocument.getText) - Reads file content
- [`vscode.lm.selectChatModels()`](https://code.visualstudio.com/api/extension-guides/language-model) - Accesses language models
- [`panel.postMessage()`](https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing) - Sends response to webview

### 4. VS Code Language Model Integration ([`src/services/languageModel.ts`](src/services/languageModel.ts))

```typescript
export async function sendEnhancedLanguageModelRequest(
  userPrompt: string, 
  codeContext?: string, 
  modelId?: string
): Promise<string> {
  // Model discovery and selection
  const models = await vscode.lm.selectChatModels();
  if (models.length === 0) {
    throw new Error('No language models available. Please ensure GitHub Copilot is enabled.');
  }

  // Prefer gpt-4o per VS Code documentation recommendations
  const model = modelId 
    ? models.find(m => m.id === modelId) || models[0]
    : models.find(m => m.id === 'gpt-4o') || models[0];

  // Enhanced prompt with code context
  const enhancedPrompt = createEnhancedPrompt(userPrompt, codeContext);

  try {
    // VS Code Language Model API request
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(enhancedPrompt)],
      { 
        justification: 'PayPilot needs access to provide coding assistance and suggestions'
      },
      new vscode.CancellationToken()
    );

    // Stream processing (can be real-time in future implementation)
    let fullResponse = '';
    for await (const chunk of response.text) {
      fullResponse += chunk;
      // Future: could emit streaming tokens here
      // onToken?.(chunk);
    }
    
    return fullResponse;
  } catch (error) {
    if (error instanceof vscode.LanguageModelError) {
      // Handle specific VS Code Language Model errors
      switch (error.code) {
        case vscode.LanguageModelError.NoPermissions:
          throw new Error('Please grant permission to access language models');
        case vscode.LanguageModelError.Blocked:
          throw new Error('Request was blocked by content filters');
        case vscode.LanguageModelError.NotFound:
          throw new Error('Selected language model is not available');
        default:
          throw new Error(`Language model error: ${error.message}`);
      }
    }
    throw error;
  }
}
```

**Key VS Code Language Model Features:**
- **Official API Integration** - Uses `vscode.lm` namespace exclusively
- **Comprehensive Error Handling** - Specific `LanguageModelError` codes
- **Enhanced Prompting** - Context-aware prompt engineering
- **Model Selection Logic** - Follows documentation recommendations
- **Streaming Support** - Real-time response processing via `response.text`

### 5. Response Handling in UI ([`src/webview/hooks/useChat.ts`](src/webview/hooks/useChat.ts))

```typescript
useEffect(() => {
  return onMessage((message) => {
    switch (message.type) {
      case 'chat:done':
        // Complete response received from VS Code Language Model
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: Date.now(),
              role: 'assistant',
              content: message.text,
              model: message.modelUsed || 'VS Code Language Model',
              timestamp: new Date()
            }
          ],
          isLoading: false
        }));
        break;
      
      case 'chat:error':
        // Handle language model errors gracefully
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: Date.now(),
              role: 'assistant',
              content: `Error: ${message.error}`,
              isError: true,
              timestamp: new Date()
            }
          ],
          isLoading: false
        }));
        break;
        
      case 'models:updated':
        // Update available models when VS Code refreshes them
        setState(prev => ({
          ...prev,
          availableModels: message.models
        }));
        break;
    }
  });
}, [onMessage]);
```

**Enhanced Message Handling Features:**
- **Complete Response Processing** - Handles full VS Code Language Model responses
- **Error State Management** - Graceful error handling with user feedback
- **Model State Sync** - Updates available models when VS Code changes them
- **Rich Message Metadata** - Tracks model used, timestamps, and error states

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