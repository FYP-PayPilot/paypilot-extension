import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { ContextButton } from './ContextButton';
import { IoSend, IoStop } from 'react-icons/io5';
import { HiSparkles, HiChevronDown } from 'react-icons/hi2';
import { BsQuestionLg } from 'react-icons/bs';
import { ModelInfo } from '../../../features/language-model/types';
import { ContextFile } from '../../../features/context/types';

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
  ragEnabled: boolean;
  onRagToggle: (enabled: boolean) => void;
}

const ASK_MODE_SUGGESTIONS: string[] = [
  "Explain this codebase to me",
  "What is the best way to integrate PayPal into this application?",
  "How can I modularise this codebase?"
];

const AGENT_MODE_SUGGESTIONS: string[] = [
  "Fix the errors in this file",
  "Integrate PayPal payment service functionality to this codebase",
  "Identify and remove all depreciated code",
  "Apply domain driven design principles to this codebase"
];

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
  onAddContext,
  ragEnabled,
  onRagToggle
}) => {
  const [inputValue, setInputValue] = useState('');
  const [placeholderText, setPlaceholderText] = useState<string>(
    ASK_MODE_SUGGESTIONS[0]
  );

  const getModelDisplayName = (value: string): string => {
    if (!value) return ragEnabled ? 'Select a backend model' : 'Select a VS Code model';
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

  useEffect(() => {
    const prompts =
      mode === "ask" ? ASK_MODE_SUGGESTIONS : AGENT_MODE_SUGGESTIONS;
    if (prompts.length === 0) {
      return;
    }

    let promptIndex = 0;
    let charIndex = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const typeRemainingCharacters = () => {
      if (cancelled) {
        return;
      }
      const currentPrompt = prompts[promptIndex];
      if (!currentPrompt) {
        return;
      }

      if (charIndex < currentPrompt.length) {
        charIndex += 1;
        setPlaceholderText(currentPrompt.slice(0, charIndex));
        timeoutId = setTimeout(typeRemainingCharacters, 60);
      } else {
        timeoutId = setTimeout(() => {
          promptIndex = (promptIndex + 1) % prompts.length;
          startNextPrompt();
        }, 2000);
      }
    };

    const startNextPrompt = () => {
      const nextPrompt = prompts[promptIndex];
      if (!nextPrompt) {
        setPlaceholderText("");
        return;
      }
      charIndex = 1;
      setPlaceholderText(nextPrompt.slice(0, charIndex));
      timeoutId = setTimeout(typeRemainingCharacters, 80);
    };

    startNextPrompt();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [mode]);

  const hasValidModelSelection = availableModels.some((model) => model.id === selectedModel);
  const selectValue = hasValidModelSelection ? selectedModel : '';
  const modelDisplayName = hasValidModelSelection
    ? getModelDisplayName(selectedModel)
    : (ragEnabled ? 'No backend models available' : 'No VS Code models available');

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
            placeholder={
              placeholderText ||
              (mode === "ask"
                ? ASK_MODE_SUGGESTIONS[0]
                : AGENT_MODE_SUGGESTIONS[0])
            }
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
                value={selectValue}
                onChange={(e) => onModelChange(e.target.value)}
                title="Select AI model"
                className="footer-select"
                disabled={disabled || availableModels.length === 0}
              >
                {availableModels.length === 0 ? (
                  <option value="" disabled>
                    {ragEnabled ? 'No backend models available' : 'No VS Code models available'}
                  </option>
                ) : (
                  availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))
                )}
              </select>
              <div className="selector-display">
                <span className="selector-text">
                  {modelDisplayName}
                </span>
                <span className="selector-chevron">
                  <HiChevronDown />
                </span>
              </div>
            </div>
          </div>

          {/* RAG Toggle */}
          <div className="selector-item">
            <button
              type="button"
              className={`rag-toggle-button ${ragEnabled ? 'active' : ''}`}
              onClick={() => onRagToggle(!ragEnabled)}
              disabled={disabled}
              title="Toggle retrieval augmented generation"
            >
              <span className="rag-toggle-label">RAG</span>
              <span className="rag-toggle-pill" aria-hidden="true">
                <span className={`rag-toggle-switch ${ragEnabled ? 'on' : ''}`} />
              </span>
              <span className="rag-toggle-state">{ragEnabled ? 'On' : 'Off'}</span>
            </button>
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
