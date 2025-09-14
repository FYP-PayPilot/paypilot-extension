import React from 'react';
import { VSCodeProvider } from './context/VSCodeContext';
import { Chat } from './components/chat/Chat';

/**
 * Root React component for the PayPilot chat interface.
 * Sets up VS Code API context and renders the main chat UI.
 */
export const App: React.FC = () => {
  return (
    <VSCodeProvider>
      <div className="app">
        <Chat />
      </div>
    </VSCodeProvider>
  );
};