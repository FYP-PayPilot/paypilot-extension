import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

/**
 * Modern chat input component with CSS classes
 */
export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, disabled = false }) => {
  const [inputValue, setInputValue] = useState('');

  /**
   * Handle sending the message
   */
  const handleSend = () => {
    if (!inputValue.trim() || disabled) return;
    
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  /**
   * Handle keyboard shortcuts
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-input">
      {/* Attach context button */}
      <div className="attach-row">
        <Button variant="ghost" size="sm" className="attach-btn">
          <PaperclipIcon />
          <span>Add context</span>
        </Button>
      </div>

      {/* Input row */}
      <div className="input-row">
        <div className="input-wrapper">
          <Textarea
            value={inputValue}
            onChange={setInputValue}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your code..."
            disabled={disabled}
            autoResize
            maxHeight={120}
          />
          {inputValue.trim() && (
            <div className="input-hints">
              <span>Press ⌘+Enter to send</span>
            </div>
          )}
        </div>
        <div className="actions">
          <Button
            variant="primary"
            size="md"
            onClick={handleSend}
            disabled={disabled || !inputValue.trim()}
            title="Send message"
          >
            <SendIcon />
          </Button>
        </div>
      </div>
    </div>
  );
};

// Icon components with clean styling
const PaperclipIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="icon">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.42 17.41a2 2 0 0 1-2.83-2.83l8.48-8.48" 
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SendIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="icon">
    <path d="m22 2-7 20-4-9-9-4 20-7Z" 
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
