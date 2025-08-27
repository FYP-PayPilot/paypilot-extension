import React from 'react';
import { VSCodeProvider } from './context/VSCodeContext';
import { Chat } from './components/chat/Chat';

/**
 * ROOT REACT COMPONENT
 * 
 * This is the main application component that serves as the root of the React component tree
 * in the VS Code webview. It sets up the foundational architecture for the entire chat interface.
 * 
 * ARCHITECTURE RESPONSIBILITIES:
 * 1. Context Setup: Provides VS Code API access to all child components
 * 2. Layout Structure: Establishes the top-level application layout
 * 3. Provider Hierarchy: Sets up the context provider pattern for state management
 * 
 * INTEGRATION WITH EXTENSION SYSTEM:
 * - Rendered by src/webview/index.tsx after React root is created
 * - VSCodeProvider enables communication with src/extension.ts via postMessage
 * - Chat component connects to the AI service through the extension host
 * 
 * COMPONENT HIERARCHY:
 * <App>
 *   └── <VSCodeProvider>          (Context for VS Code API access)
 *       └── <div className="app">  (CSS layout container)
 *           └── <Chat>             (Main chat interface)
 *               ├── <ChatMessage>  (Message display)
 *               ├── <ChatInput>    (User input)
 *               └── <ActionButtons> (Code application)
 * 
 * STYLING INTEGRATION:
 * - Uses 'app' CSS class defined in src/media/global.css
 * - CSS provides VS Code theme integration and responsive layout
 * - Inherits VS Code color variables for seamless UI integration
 * 
 * DATA FLOW SETUP:
 * 1. VSCodeProvider creates communication channel to extension.ts
 * 2. Chat component uses useChat() hook for state management
 * 3. User interactions flow: UI → useChat → VSCodeProvider → extension.ts → DeepSeek API
 * 4. AI responses flow: DeepSeek API → extension.ts → VSCodeProvider → useChat → UI
 */

/**
 * Main application component that sets up the entire chat interface
 * 
 * This component establishes the foundation for the VS Code webview application by:
 * - Providing VS Code API access through React Context
 * - Setting up the main application layout
 * - Rendering the chat interface
 * 
 * CONTEXT PROVIDER PATTERN:
 * The VSCodeProvider wraps the entire application to ensure that any component
 * in the tree can access the VS Code API for communication with the extension host.
 * This follows React best practices for dependency injection and state management.
 * 
 * LAYOUT STRATEGY:
 * The 'app' CSS class provides a flex layout that fills the entire webview space,
 * ensuring the chat interface uses all available screen real estate effectively.
 * 
 * @returns JSX element representing the complete webview application
 */
export const App: React.FC = () => {
  return (
    // VSCodeProvider makes VS Code API available to all child components
    // This enables communication with the extension host (src/extension.ts)
    <VSCodeProvider>
      {/* 
        Main application container with CSS layout
        - Uses 'app' class from src/media/global.css
        - Provides flexbox layout for the chat interface
        - Inherits VS Code theme colors and spacing
      */}
      <div className="app">
        {/* 
          Main chat interface component
          - Renders the complete chat UI (messages, input, actions)
          - Uses useChat() hook for state management
          - Communicates with extension via VSCodeProvider context
        */}
        <Chat />
      </div>
    </VSCodeProvider>
  );
};

/**
 * COMPONENT LIFECYCLE IN THE EXTENSION:
 * 
 * 1. INITIALIZATION:
 *    - extension.ts activates and creates ChatViewProvider
 *    - ChatViewProvider creates webview and loads HTML from html.ts
 *    - HTML includes script tag that loads the bundled React app
 *    - index.tsx executes and renders <App />
 * 
 * 2. SETUP:
 *    - <App /> renders and creates VSCodeProvider
 *    - VSCodeProvider establishes message communication channel
 *    - <Chat /> component mounts and initializes useChat() hook
 * 
 * 3. RUNTIME:
 *    - User types messages in ChatInput component
 *    - Messages flow through useChat → VSCodeProvider → extension.ts
 *    - extension.ts processes requests via DeepSeek service
 *    - Responses stream back through the same channel in reverse
 * 
 * 4. CODE APPLICATION:
 *    - ActionButtons allow applying AI-generated code
 *    - Requests flow to extension.ts which modifies VS Code files
 *    - Success/error feedback returns to the webview for user notification
 * 
 * SECURITY MODEL:
 * - Webview runs in sandboxed environment with no direct file access
 * - All file operations must go through the extension host
 * - Communication uses VS Code's secure postMessage API
 * - Content Security Policy prevents XSS and unauthorized resource loading
 */