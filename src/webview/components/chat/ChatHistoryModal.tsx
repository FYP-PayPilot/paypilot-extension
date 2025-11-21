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
  onCleanupDuplicates?: () => void;
}

export const ChatHistoryModal: React.FC<ChatHistoryModalProps> = ({
  isOpen,
  onClose,
  chatHistory,
  onLoadChat,
  onDeleteChat,
  onCleanupDuplicates,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<ChatSession | null>(null);
  const [showCleanupConfirm, setShowCleanupConfirm] = React.useState(false);

  if (!isOpen) return null;

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const handleLoadChat = (chat: ChatSession) => {
    onLoadChat(chat);
    onClose();
  };

  const handleDeleteChat = (chat: ChatSession) => {
    console.log('Delete button clicked for chat:', chat.title);
    setShowDeleteConfirm(chat);
  };

  const confirmDelete = () => {
    if (showDeleteConfirm) {
      console.log('Confirming delete for chat:', showDeleteConfirm.title);
      onDeleteChat(showDeleteConfirm.id);
      setShowDeleteConfirm(null);
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(null);
  };

  const handleCleanup = () => {
    setShowCleanupConfirm(true);
  };

  const confirmCleanup = () => {
    if (onCleanupDuplicates) {
      onCleanupDuplicates();
    }
    setShowCleanupConfirm(false);
  };

  const cancelCleanup = () => {
    setShowCleanupConfirm(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-left">
            <h3>Chat History</h3>
            {onCleanupDuplicates && chatHistory.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCleanup}
                className="cleanup-button"
                title="Remove duplicate conversations"
              >
                Clean Up
              </Button>
            )}
          </div>
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
                  <div className="history-item-content" onClick={() => {
                    console.log('History item clicked!', chat.title);
                    handleLoadChat(chat);
                  }}>
                    <div className="history-title">{chat.title}</div>
                    <div className="history-meta">
                      {formatDate(chat.timestamp)} • {chat.messages.length} messages
                    </div>
                  </div>
                  <div className="history-actions" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    <button
                      className="delete-button-simple"
                      onClick={() => {
                        console.log('Delete button clicked!', chat.title);
                        handleDeleteChat(chat);
                      }}
                      title="Delete this conversation"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="confirmation-overlay" onClick={cancelDelete}>
          <div className="confirmation-dialog" onClick={(e) => e.stopPropagation()}>
            <h4>Delete Chat</h4>
            <p>Are you sure you want to delete "{showDeleteConfirm.title}"?</p>
            <p className="warning-text">This action cannot be undone.</p>
            <div className="confirmation-actions">
              <Button variant="ghost" size="sm" onClick={cancelDelete}>
                Cancel
              </Button>
              <Button variant="ghost" size="sm" onClick={confirmDelete} className="confirm-delete-button">
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cleanup Confirmation Dialog */}
      {showCleanupConfirm && (
        <div className="confirmation-overlay" onClick={cancelCleanup}>
          <div className="confirmation-dialog" onClick={(e) => e.stopPropagation()}>
            <h4>Clean Up History</h4>
            <p>This will remove duplicate conversations from your history.</p>
            <p className="warning-text">Continue with cleanup?</p>
            <div className="confirmation-actions">
              <Button variant="ghost" size="sm" onClick={cancelCleanup}>
                Cancel
              </Button>
              <Button variant="ghost" size="sm" onClick={confirmCleanup} className="confirm-cleanup-button">
                Clean Up
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};