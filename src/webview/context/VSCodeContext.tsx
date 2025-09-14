import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../../types/chat';

/**
 * React context for VS Code webview communication.
 * Provides type-safe message passing and handles streaming AI responses.
 */

interface VSCodeAPI {
  postMessage(message: any): void;
  setState(state: any): void;
  getState(): any;
}

declare global {
  interface Window {
    acquireVsCodeApi(): VSCodeAPI;
  }
}

interface VSCodeContextType {
  postMessage: (message: WebviewToExtensionMessage) => void;
  onMessage: (callback: (message: ExtensionToWebviewMessage) => void) => () => void;
}

const VSCodeContext = createContext<VSCodeContextType | null>(null);

/**
 * Provider component that establishes VS Code API communication.
 * Manages real-time message routing for streaming AI responses.
 */
export const VSCodeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [vscode] = useState(() => window.acquireVsCodeApi());
  const [messageListeners] = useState<Set<(message: ExtensionToWebviewMessage) => void>>(new Set());

  // Send messages to extension (chat requests, stop commands, etc.)
  const postMessage = useCallback((message: WebviewToExtensionMessage) => {
    vscode.postMessage(message);
  }, [vscode]);

  /**
   * Registers streaming message listener with cleanup function.
   * Enables real-time token reception from extension during AI responses.
   */
  const onMessage = useCallback((callback: (message: ExtensionToWebviewMessage) => void) => {
    messageListeners.add(callback);
    return () => messageListeners.delete(callback);  // Cleanup function
  }, [messageListeners]);

  // Global message router: distributes incoming messages to all registered listeners
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ExtensionToWebviewMessage;
      // Broadcast to all listeners (e.g., useChat hook for streaming tokens)
      messageListeners.forEach(listener => listener(message));
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [messageListeners]);

  const value: VSCodeContextType = { postMessage, onMessage };

  return (
    <VSCodeContext.Provider value={value}>
      {children}
    </VSCodeContext.Provider>
  );
};

/**
 * Hook to access VS Code API context.
 * Provides postMessage and onMessage for extension communication.
 */
export const useVSCode = (): VSCodeContextType => {
  const context = useContext(VSCodeContext);
  
  if (!context) {
    throw new Error('useVSCode must be used within a VSCodeProvider');
  }
  
  return context;
};