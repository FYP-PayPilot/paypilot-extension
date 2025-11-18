import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../../hooks/useChat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ContextList } from './ContextList';
import { ChatControls } from './ChatControls';
import { ChatHistoryModal } from './ChatHistoryModal';

const ALLOWED_VSCODE_MODEL_KEYWORDS = [
  '4o',
  '4omini',
  'grokcodefast',
  'gpt4mini',
  'gpt41'
];

const normalizeModelKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9.]/g, '');

/**
 * Main chat component that orchestrates the entire chat interface
 */
export const Chat: React.FC = () => {
  const {
    messages,
    isLoading,
    mode,
    sendMessage,
    stopGeneration,
    setMode,
    availableModels,
    selectedModel,
    onModelChange,
    contextFiles,
    handleAddContext,
    removeContextFile,
    clearAllContext,
    handleNewChat,
    handleChatHistory,
    showHistoryModal,
    setShowHistoryModal,
    getChatHistory,
    chatHistory,
    handleLoadChat,
    handleDeleteChat,
    cleanupDuplicateHistory
  } = useChat();

  const [ragEnabled, setRagEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const filteredModels = useMemo(() => {
    if (ragEnabled) {
      return availableModels.filter((model) => model.source === 'backend');
    }

    return availableModels.filter((model) => {
      if (model.source && model.source !== 'vscode') {
        return false;
      }

      const candidates = [model.name, model.family ?? '', model.id]
        .filter(Boolean)
        .map((value) => normalizeModelKey(String(value)));

      return candidates.some((candidate) =>
        ALLOWED_VSCODE_MODEL_KEYWORDS.some((keyword) =>
          candidate.includes(keyword)
        )
      );
    });
  }, [availableModels, ragEnabled]);

  useEffect(() => {
    if (filteredModels.length === 0) {
      return;
    }

    const hasSelection = filteredModels.some((model) => model.id === selectedModel);
    if (!hasSelection) {
      onModelChange(filteredModels[0].id);
    }
  }, [filteredModels, selectedModel, onModelChange]);

  /**
   * Auto-scroll to bottom when new messages arrive
   */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat-container">
      {/* Chat Controls */}
      <ChatControls 
        onNewChat={handleNewChat}
        onChatHistory={handleChatHistory}
        disabled={isLoading}
      />

      {/* Messages area */}
      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <LightningIcon />
            </div>
            <div className="empty-title">Ready to help with your code</div>
            <div className="empty-description">
              Switch to Agent mode to make changes, or Ask mode to brainstorm.
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

      {/* Context files display */}
      <ContextList 
        contextFiles={contextFiles}
        onRemoveFile={removeContextFile}
        onClearAll={clearAllContext}
      />

      {/* Input with send/stop functionality and controls footer */}
      <div className="chat-footer">
        <ChatInput
          onSendMessage={sendMessage}
          onStopGeneration={stopGeneration}
          disabled={false}
          isLoading={isLoading}
          mode={mode}
          onModeChange={setMode}
          selectedModel={selectedModel || ''}
          onModelChange={onModelChange}
          availableModels={filteredModels}
          contextFiles={contextFiles}
          onAddContext={handleAddContext}
          ragEnabled={ragEnabled}
          onRagToggle={setRagEnabled}
        />
      </div>

      {/* Chat History Modal */}
      <ChatHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        chatHistory={chatHistory}
        onLoadChat={handleLoadChat}
        onDeleteChat={handleDeleteChat}
        onCleanupDuplicates={cleanupDuplicateHistory}
      />
    </div>
  );
};

// Clean lightning bolt icon
const LightningIcon: React.FC = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="welcome-icon">
    <path 
      d="M13 2L4.09 12.97A1 1 0 0 0 5 14.5h4.5l-1.5 7.5 8.91-10.97A1 1 0 0 0 16 9.5h-4.5L13 2z" 
      fill="var(--vscode-focusBorder)"
      opacity="0.8"
    />
  </svg>
);
