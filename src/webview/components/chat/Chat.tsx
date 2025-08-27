import React, { useEffect, useRef } from 'react';
import { useChat } from '../../hooks/useChat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ActionButtons } from './ActionButtons';

/**
 * Main chat component that orchestrates the entire chat interface
 */
export const Chat: React.FC = () => {
  const {
    messages,
    isLoading,
    canApplyCode,
    sendMessage,
    applyToSelection,
    replaceFile,
    createNewFile
  } = useChat();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  /**
   * Auto-scroll to bottom when new messages arrive
   */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat-container">
      {/* Messages area */}
      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <BubbleStarIcon />
            </div>
            <div className="empty-title">Ready to help with your code</div>
            <div className="empty-description">
              Ask questions about your code, get explanations, or request refactoring help.
            </div>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input and actions */}
      <div className="chat-footer">
        <ActionButtons
          canApplyCode={canApplyCode}
          onApplyToSelection={applyToSelection}
          onReplaceFile={replaceFile}
          onCreateNewFile={createNewFile}
        />
        <ChatInput
          onSendMessage={sendMessage}
          disabled={isLoading}
        />
      </div>
    </div>
  );
};

// Clean lightning bolt icon
const BubbleStarIcon: React.FC = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="welcome-icon">
    <path 
      d="M13 2L4.09 12.97A1 1 0 0 0 5 14.5h4.5l-1.5 7.5 8.91-10.97A1 1 0 0 0 16 9.5h-4.5L13 2z" 
      fill="var(--vscode-focusBorder)"
      opacity="0.8"
    />
  </svg>
);
