import React from 'react';
import { VSCodeProvider } from './context/VSCodeContext';
import { Chat } from './components/chat/Chat';

/**
 * Main application component
 * Sets up the VS Code context and renders the chat interface
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
