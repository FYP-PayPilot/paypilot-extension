import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../../types/chat';

/**
 * VS CODE WEBVIEW COMMUNICATION BRIDGE
 * 
 * This file creates the critical communication layer between the React application
 * and the VS Code extension host. It provides a clean, type-safe interface for
 * message passing across the webview security boundary.
 * 
 * ARCHITECTURE ROLE:
 * - Bridges the gap between the sandboxed webview environment and the extension host
 * - Wraps VS Code's webview API in a React-friendly context provider
 * - Enables type-safe communication using interfaces from src/types/chat.ts
 * - Provides message routing and listener management for real-time communication
 * 
 * INTEGRATION WITH EXTENSION SYSTEM:
 * → OUTBOUND (Webview → Extension):
 *   React Components → useVSCode hook → postMessage → extension.ts message handler
 * 
 * ← INBOUND (Extension → Webview):
 *   DeepSeek API → extension.ts → ChatViewProvider.postMessage → this context → React hooks
 * 
 * MESSAGE FLOW EXAMPLES:
 * 1. Chat Request: ChatInput → useChat → postMessage('chat:ask') → extension.ts → DeepSeek API
 * 2. Streaming Response: DeepSeek → extension.ts → postMessage('chat:stream') → useChat → ChatMessage
 * 3. Code Application: ActionButtons → postMessage('editor:applyEdit') → extension.ts → VS Code API
 * 
 * SECURITY CONSIDERATIONS:
 * - Uses VS Code's acquireVsCodeApi() for secure communication channel
 * - All messages are typed and validated using TypeScript interfaces
 * - No direct access to Node.js APIs or file system from webview
 * - Communication happens through VS Code's controlled postMessage system
 */

/**
 * VS Code API interface provided by the webview runtime
 * 
 * This interface represents the API that VS Code provides to webviews for secure
 * communication with the extension host. It's injected into the global window object
 * when the webview loads.
 * 
 * METHODS:
 * - postMessage: Send data to the extension host
 * - setState: Persist state across webview reloads (not currently used)
 * - getState: Retrieve persisted state (not currently used)
 */
interface VSCodeAPI {
  postMessage(message: any): void;     // Send message to extension host
  setState(state: any): void;          // Persist state in VS Code
  getState(): any;                     // Retrieve persisted state
}

/**
 * Global window declaration for VS Code webview API
 * 
 * VS Code injects the acquireVsCodeApi function into the global window object
 * when a webview loads. This declaration ensures TypeScript recognizes it.
 */
declare global {
  interface Window {
    acquireVsCodeApi(): VSCodeAPI;
  }
}

/**
 * Context interface for React components
 * 
 * Defines the clean, typed interface that React components use to communicate
 * with the VS Code extension. This abstraction hides the complexity of the
 * underlying postMessage system.
 */
interface VSCodeContextType {
  /** Send a typed message to the extension host */
  postMessage: (message: WebviewToExtensionMessage) => void;
  
  /** Register a listener for messages from the extension host */
  onMessage: (callback: (message: ExtensionToWebviewMessage) => void) => () => void;
}

/**
 * React context for VS Code API access
 * 
 * This context makes the VS Code communication interface available to any
 * component in the React tree. Components can use the useVSCode hook to
 * access these capabilities.
 */
const VSCodeContext = createContext<VSCodeContextType | null>(null);

/**
 * Provider component that wraps the VS Code API in React context
 * 
 * This component establishes the communication bridge when the React app mounts.
 * It acquires the VS Code API, sets up message routing, and provides a clean
 * interface for child components.
 * 
 * INITIALIZATION SEQUENCE:
 * 1. Component mounts and calls window.acquireVsCodeApi()
 * 2. Sets up message listener management system
 * 3. Provides postMessage and onMessage functions to children
 * 4. Child components can now communicate with extension.ts
 * 
 * MESSAGE LISTENER PATTERN:
 * - Uses a Set to manage multiple message listeners efficiently
 * - Allows multiple components to listen for different message types
 * - Provides cleanup functions to prevent memory leaks
 * - Routes all incoming messages to registered listeners
 * 
 * @param children React components that need VS Code API access
 */
export const VSCodeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Acquire the VS Code API once when the component mounts
  // This API is provided by VS Code and enables secure communication
  const [vscode] = useState(() => window.acquireVsCodeApi());
  
  // Track all message listeners to enable broadcasting
  // Using Set for efficient add/remove operations
  const [messageListeners] = useState<Set<(message: ExtensionToWebviewMessage) => void>>(new Set());

  /**
   * Send a message to the VS Code extension host
   * 
   * This function provides type-safe message sending to the extension.
   * Messages are defined in src/types/chat.ts and handled in extension.ts.
   * 
   * USAGE EXAMPLES:
   * - Chat requests: postMessage({ type: 'chat:ask', prompt: 'Hello' })
   * - Code application: postMessage({ type: 'editor:applyEdit', payload: { mode: 'selection', code: 'const x = 1;' } })
   * - File creation: postMessage({ type: 'editor:createFile', payload: { code: 'console.log("hello");' } })
   * 
   * @param message Typed message object conforming to WebviewToExtensionMessage interface
   */
  const postMessage = useCallback((message: WebviewToExtensionMessage) => {
    vscode.postMessage(message);
  }, [vscode]);

  /**
   * Register a listener for messages from the extension host
   * 
   * This function allows React components to listen for responses and updates
   * from the extension. Multiple components can register listeners simultaneously.
   * 
   * LISTENER MANAGEMENT:
   * - Returns an unsubscribe function for cleanup
   * - Automatically removes listeners when components unmount
   * - Prevents memory leaks in long-running webviews
   * 
   * USAGE PATTERN:
   * ```typescript
   * useEffect(() => {
   *   const unsubscribe = onMessage((message) => {
   *     if (message.type === 'chat:stream') {
   *       // Handle streaming response
   *     }
   *   });
   *   return unsubscribe; // Cleanup on unmount
   * }, []);
   * ```
   * 
   * @param callback Function to call when messages arrive from extension
   * @returns Cleanup function to remove the listener
   */
  const onMessage = useCallback((callback: (message: ExtensionToWebviewMessage) => void) => {
    messageListeners.add(callback);
    
    // Return cleanup function for component unmounting
    return () => messageListeners.delete(callback);
  }, [messageListeners]);

  /**
   * Set up the global message listener when the component mounts
   * 
   * This effect establishes the bridge between VS Code's postMessage system
   * and our React-based listener system. It:
   * 1. Listens for all messages from the extension host
   * 2. Routes them to all registered component listeners
   * 3. Provides type safety through the ExtensionToWebviewMessage interface
   * 
   * MESSAGE TYPES HANDLED:
   * - 'chat:stream': Real-time AI response tokens
   * - 'chat:done': Complete AI response
   * - 'chat:error': Error messages from AI service
   * - 'editor:applied': Confirmation of code application
   * 
   * INTEGRATION WITH EXTENSION.TS:
   * When extension.ts calls chatProvider.postMessage(), it triggers this listener
   * which then broadcasts the message to all registered React component listeners.
   */
  useEffect(() => {
    /**
     * Handle incoming messages from the extension host
     * 
     * @param event MessageEvent from VS Code's postMessage system
     */
    const handleMessage = (event: MessageEvent) => {
      // Extract and type the message data
      const message = event.data as ExtensionToWebviewMessage;
      
      // Broadcast to all registered listeners
      // This allows multiple components to react to the same message
      messageListeners.forEach(listener => listener(message));
    };

    // Register global message listener
    window.addEventListener('message', handleMessage);
    
    // Cleanup listener when component unmounts
    return () => window.removeEventListener('message', handleMessage);
  }, [messageListeners]);

  // Create the context value with our communication functions
  const value: VSCodeContextType = {
    postMessage,
    onMessage
  };

  // Provide the VS Code API context to all child components
  return (
    <VSCodeContext.Provider value={value}>
      {children}
    </VSCodeContext.Provider>
  );
};

/**
 * Custom hook to access the VS Code API context
 * 
 * This hook provides a convenient way for React components to access
 * the VS Code communication capabilities. It includes error checking
 * to ensure components are properly wrapped in VSCodeProvider.
 * 
 * USAGE IN COMPONENTS:
 * ```typescript
 * const MyComponent = () => {
 *   const { postMessage, onMessage } = useVSCode();
 *   
 *   const sendChatMessage = () => {
 *     postMessage({ type: 'chat:ask', prompt: 'Hello AI' });
 *   };
 *   
 *   useEffect(() => {
 *     return onMessage((message) => {
 *       // Handle responses
 *     });
 *   }, []);
 * };
 * ```
 * 
 * ERROR HANDLING:
 * Throws a descriptive error if used outside of VSCodeProvider,
 * helping developers identify context setup issues quickly.
 * 
 * @returns VSCodeContextType interface for extension communication
 * @throws Error if used outside of VSCodeProvider
 */
export const useVSCode = (): VSCodeContextType => {
  const context = useContext(VSCodeContext);
  
  if (!context) {
    throw new Error(
      'useVSCode must be used within a VSCodeProvider. ' +
      'Ensure that your component is wrapped in <VSCodeProvider> in App.tsx.'
    );
  }
  
  return context;
};

/**
 * COMMUNICATION FLOW SUMMARY:
 * 
 * 1. SETUP PHASE:
 *    App.tsx → VSCodeProvider → acquireVsCodeApi() → Communication Bridge Established
 * 
 * 2. OUTBOUND MESSAGES (React → Extension):
 *    Component → useVSCode() → postMessage() → extension.ts → AI Service/File Operations
 * 
 * 3. INBOUND MESSAGES (Extension → React):
 *    AI Service → extension.ts → chatProvider.postMessage() → VSCodeProvider → Component Listeners
 * 
 * 4. STREAMING EXAMPLE:
 *    useChat calls postMessage('chat:ask') → extension.ts processes → DeepSeek streams →
 *    extension.ts sends 'chat:stream' messages → VSCodeProvider routes → useChat updates UI
 * 
 * 5. CODE APPLICATION EXAMPLE:
 *    ActionButtons calls postMessage('editor:applyEdit') → extension.ts applies code →
 *    VS Code API modifies file → extension.ts sends 'editor:applied' → UI shows confirmation
 * 
 * This architecture ensures type-safe, secure communication while maintaining
 * clean separation between the webview UI and the extension host logic.
 */