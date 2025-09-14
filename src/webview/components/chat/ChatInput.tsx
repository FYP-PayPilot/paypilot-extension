import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { ContextButton } from './ContextButton';
import { IoSend, IoStop } from 'react-icons/io5';
import { HiSparkles, HiChevronDown, HiInformationCircle } from 'react-icons/hi2';
import { BsQuestionLg } from 'react-icons/bs';
import { ModelInfo, ContextFile, McpServer } from '../../../types/chat';

interface ChatInputProps {
  onSendMessage: (message: string, mode: 'agent' | 'ask') => void;
  onStopGeneration: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  mode: 'agent' | 'ask';
  onModeChange: (mode: 'agent' | 'ask') => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  availableModels: ModelInfo[];
  contextFiles: ContextFile[];
  onAddContext: () => void;
  mcpEnabled: boolean;
  onMcpToggle: (enabled: boolean) => void;
  mcpServers: McpServer[];
  selectedServers: string[];
  onServerSelection: (servers: string[]) => void;
  onMcpInfo: () => void;
}

/**
 * Modern chat input component with send/stop functionality and footer controls
 */
export const ChatInput: React.FC<ChatInputProps> = ({ 
  onSendMessage, 
  onStopGeneration,
  disabled = false, 
  isLoading = false,
  mode,
  onModeChange,
  selectedModel,
  onModelChange,
  availableModels,
  contextFiles,
  onAddContext,
  mcpEnabled,
  onMcpToggle,
  mcpServers,
  selectedServers,
  onServerSelection,
  onMcpInfo
}) => {
  const [inputValue, setInputValue] = useState('');

  /**
   * Get display name for a model value
   */
  const getModelDisplayName = (value: string): string => {
    if (!value) return 'Loading models...';
    const model = availableModels.find(m => m.id === value);
    return model ? model.name : value;
  };

  /**
   * Handle sending the message
   */
  const handleSend = () => {
    if (!inputValue.trim() || disabled) return;
    
    onSendMessage(inputValue.trim(), mode);
    setInputValue('');
  };

  /**
   * Handle stopping generation
   */
  const handleStop = () => {
    onStopGeneration();
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

  /**
   * Handle MCP server selection toggle
   */
  const handleServerToggle = (serverName: string) => {
    const newSelection = selectedServers.includes(serverName)
      ? selectedServers.filter(s => s !== serverName)
      : [...selectedServers, serverName];
    onServerSelection(newSelection);
  };

  return (
    <div className="chat-input">
      {/* Add Context button - moved above input */}
      <div className="context-button-row">
        <ContextButton 
          onClick={onAddContext}
          disabled={disabled}
        />
      </div>

      {/* Input row */}
      <div className="input-row">
        <div className="input-wrapper">
          <Textarea
            value={inputValue}
            onChange={setInputValue}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'agent' ? "Tell me what to change in your code..." : "Ask about your code..."}
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
      </div>

      {/* Footer controls - selectors left, send button right */}
      <div className="chat-controls-footer">
        {/* Selectors - Left Side */}
        <div className="selectors-container">
          {/* Mode Selector Dropdown */}
          <div className="selector-item">
            <div className="selector-wrapper">
              <select
                value={mode}
                onChange={(e) => onModeChange(e.target.value as 'agent' | 'ask')}
                title="Select interaction mode"
                className="footer-select"
              >
                <option value="ask">Ask</option>
                <option value="agent">Agent</option>
              </select>
              <div className="selector-display">
                <span className="selector-icon">
                  {mode === 'ask' ? <BsQuestionLg /> : <HiSparkles />}
                </span>
                <span className="selector-text">
                  {mode === 'ask' ? 'Ask' : 'Agent'}
                </span>
                <span className="selector-chevron">
                  <HiChevronDown />
                </span>
              </div>
            </div>
          </div>

          {/* Model Selector */}
          <div className="selector-item">
            <div className="selector-wrapper">
              <select
                value={selectedModel}
                onChange={(e) => onModelChange(e.target.value)}
                title="Select AI model"
                className="footer-select"
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <div className="selector-display">
                <span className="selector-text">
                  {getModelDisplayName(selectedModel)}
                </span>
                <span className="selector-chevron">
                  <HiChevronDown />
                </span>
              </div>
            </div>
          </div>

          {/* MCP Selector */}
          <div className="selector-item">
            <div className="selector-wrapper">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleServerToggle(e.target.value);
                    e.target.value = ""; // Reset select
                  }
                }}
                title="Select MCP servers"
                className="footer-select"
              >
                <option value="">Select MCP servers...</option>
                {mcpServers.map((server) => (
                  <option key={server.name} value={server.name}>
                    {selectedServers.includes(server.name) ? '✓ ' : ''}{server.name} ({server.type})
                  </option>
                ))}
                {mcpServers.length === 0 && (
                  <option value="" disabled>No MCP servers configured</option>
                )}
              </select>
              <div className="selector-display">
                <span className="selector-icon">
                  <HiInformationCircle />
                </span>
                <span className="selector-text">
                  MCP ({selectedServers.length}/{mcpServers.length})
                </span>
                <span className="selector-chevron">
                  <HiChevronDown />
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Send/Stop Button - Right Side */}
        <div className="send-button-container">
          <SendButton
            isLoading={isLoading}
            disabled={disabled || (!isLoading && !inputValue.trim())}
            onClick={isLoading ? handleStop : handleSend}
          />
        </div>
      </div>
    </div>
  );
};

// Send Button Component
interface SendButtonProps {
  isLoading: boolean;
  disabled: boolean;
  onClick: () => void;
}

const SendButton: React.FC<SendButtonProps> = ({ isLoading, disabled, onClick }) => {
  return (
    <Button
      variant="primary"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={isLoading ? "Stop generation" : "Send message"}
    >
      {isLoading ? (
        <IoStop size={14} />
      ) : (
        <IoSend size={14} />
      )}
    </Button>
  );
};
