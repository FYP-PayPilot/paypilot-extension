import { useVSCode } from '../../context/VSCodeContext';
import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { IoSend, IoStop } from 'react-icons/io5';
import { HiSparkles, HiChevronDown } from 'react-icons/hi2';
import { BsQuestionLg } from 'react-icons/bs';
import { FcAbout } from "react-icons/fc";

interface ChatInputProps {
  onSendMessage: (message: string, mode: 'agent' | 'ask') => void;
  onStopGeneration: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  mode: 'agent' | 'ask';
  onModeChange: (mode: 'agent' | 'ask') => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

// array containing models
const models = [
  { value: 'deepseek-chat', label: 'DeepSeek' },
  { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
  { value: 'gpt-4-1', label:"GPT 4.1" }
];

/**
 * Get display name for a model value
 */
const getModelDisplayName = (value: string): string => {
  return models.find(model => model.value === value)?.label || value;
};

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
  onModelChange
}) => {
  const { postMessage, onMessage } = useVSCode();
  const [inputValue, setInputValue] = useState('');
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [showMcpDropdown, setShowMcpDropdown] = useState(false);
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [selectedServers, setSelectedServers] = useState<string[]>([]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "mcp:servers") {
        setMcpServers(msg.servers || []);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

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

  return (
    <div className="chat-input">
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
                {models.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
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
      {/* MCP Servers Checkbox */}
      <div className="mcp-checkbox-row" style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
        <input
          type="checkbox"
          id="enable-mcp"
          style={{ marginRight: 6 }}
          checked={mcpEnabled}
          onChange={(e) => {
        const checked = e.target.checked;
        setMcpEnabled(checked);
        postMessage({ type: 'mcp:toggle', enabled: checked });
          }}
        />
        <label htmlFor="enable-mcp" style={{ marginRight: 8 }}>
          Enable MCP servers
        </label>
        <button
          type="button"
          title="Show existing MCP servers in your VSCode config"
          style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center'
          }}
          onClick={() => {
        if (!showMcpDropdown) postMessage({ type: 'mcp:get'});
        setShowMcpDropdown((prev) => !prev);
          }}
        >
          <FcAbout size={16} />
        </button>
      </div>
      {/* MCP Servers Dropdown */}
      {showMcpDropdown && (
        <div
          style={{
        border: '1px solid #ccc',
        borderRadius: 6,
        marginTop: 8,
        padding: 8,
        background: '#1e1e1e',
        minWidth: 260,
          }}
        >
          <label htmlFor="mcp-server-select" style={{ color: '#fff', marginBottom: 4, display: 'block' }}>
        Select MCP server(s):
          </label>
          <select
        id="mcp-server-select"
        multiple
        style={{
          width: '100%',
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid #444',
          background: '#222',
          color: '#fff',
          maxHeight: 120,
          marginBottom: 8,
        }}
        value={selectedServers}
        onChange={e => {
          const options = Array.from(e.target.selectedOptions).map(opt => opt.value);
          setSelectedServers(options);
        }}
          >
        {mcpServers.length === 0 ? (
          <option disabled value="">No MCP servers configured</option>
        ) : (
          mcpServers.map(server => (
            <option key={server} value={server}>
          {server}
            </option>
          ))
        )}
          </select>
        </div>
      )}
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
