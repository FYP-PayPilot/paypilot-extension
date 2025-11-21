import React from 'react';
import { Button } from '../ui/Button';

interface ChatControlsProps {
  onNewChat: () => void;
  onChatHistory: () => void;
  disabled?: boolean;
}

/**
 * Chat control buttons for new chat and history
 */
export const ChatControls: React.FC<ChatControlsProps> = ({ 
  onNewChat, 
  onChatHistory, 
  disabled = false 
}) => {
  return (
    <div className="chat-controls">
      <Button
        variant="ghost"
        size="sm"
        onClick={onNewChat}
        disabled={disabled}
        title="Start a new chat"
        className="new-chat-button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14m-7-7h14"/>
        </svg>
        New Chat
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        onClick={onChatHistory}
        disabled={disabled}
        title="View chat history"
        className="chat-history-button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12,6 12,12 16,14"/>
        </svg>
        History
      </Button>
    </div>
  );
};