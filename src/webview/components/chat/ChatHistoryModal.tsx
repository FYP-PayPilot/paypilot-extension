import React from 'react';
import { Button } from '../ui/Button';

interface ChatSession {
  id: string;
  messages: any[];
  timestamp: number;
  title: string;
}

interface ChatHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatHistory: ChatSession[];
  onLoadChat: (chat: ChatSession) => void;
  onDeleteChat: (chatId: string) => void;
}

export const ChatHistoryModal: React.FC<ChatHistoryModalProps> = ({
  isOpen,
  onClose,
  chatHistory,
  onLoadChat,
  onDeleteChat,
}) => {
  if (!isOpen) return null;

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const handleLoadChat = (chat: ChatSession) => {
    onLoadChat(chat);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Chat History</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="close-button"
          >
            ×
          </Button>
        </div>
        
        <div className="modal-body">
          {chatHistory.length === 0 ? (
            <div className="empty-history">
              <p>No chat history found. Start a conversation to see it here!</p>
            </div>
          ) : (
            <div className="history-list">
              {chatHistory.map((chat, index) => (
                <div key={chat.id} className="history-item">
                  <div className="history-item-content">
                    <div className="history-title">{chat.title}</div>
                    <div className="history-meta">
                      {formatDate(chat.timestamp)} • {chat.messages.length} messages
                    </div>
                  </div>
                  <div className="history-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleLoadChat(chat)}
                      className="load-button"
                    >
                      Load
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteChat(chat.id)}
                      className="delete-button"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};