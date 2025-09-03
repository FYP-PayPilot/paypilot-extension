import { useState, useCallback, useEffect, useRef } from 'react';
import { ChatMessage, ChatState, ModelInfo } from '../../types/chat';
import { useVSCode } from '../context/VSCodeContext';

/**
 * Chat state management hook - handles AI streaming and real-time UI updates
 */
export const useChat = () => {
  const { postMessage, onMessage } = useVSCode();
  
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false,        // Tracks active AI generation for UI state
    mode: 'ask'
  });

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(''); // Start empty until models load
  const hasAutoSelectedModel = useRef(false); // Track if we've done initial auto-selection

  // Generate unique message IDs
  const generateMessageId = useCallback(() => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Auto-load models when extension starts
  useEffect(() => {
    postMessage({ type: 'model:list-request' });
  }, [postMessage]);

  // Smart model loading - only load if we don't have models yet (fallback)
  const loadModels = useCallback(() => {
    if (availableModels.length === 0) {
      postMessage({ type: 'model:list-request' });
    }
  }, [postMessage, availableModels.length]);

  // Send user message and trigger streaming AI response
  const sendMessage = useCallback((prompt: string, mode: 'agent' | 'ask') => {
    if (!prompt.trim() || state.isLoading) {
      return;
    }

    if (!selectedModel) {
      console.error('No model selected');
      return;
    }

    // Create user message and placeholder for streaming response
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      content: prompt.trim(),
      role: 'user',
      timestamp: Date.now()
    };

    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      content: 'Thinking...',           // Placeholder until first token arrives
      role: 'assistant',
      timestamp: Date.now(),
      isStreaming: true                 // Enables real-time content updates
    };

    // Add messages to UI and prepare for streaming
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage, assistantMessage],
      isLoading: true,                  // Shows loading state, disables input
      mode: mode                        // Updates current interaction mode
    }));

    // Trigger AI request - will result in streaming tokens
    postMessage({
      type: 'chat:ask',
      prompt: prompt.trim(),
      mode: mode,
      model: selectedModel
    });
  }, [state.isLoading, generateMessageId, postMessage, selectedModel]);

  // Interrupt ongoing AI generation
  const stopGeneration = useCallback(() => {
    if (!state.isLoading) {
      return;
    }

    // Send stop signal to extension/API
    postMessage({
      type: 'chat:stop'
    });

    // Update UI to show generation was stopped
    setState(prev => {
      const messages = [...prev.messages];
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
        messages[messages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content === 'Thinking...' 
            ? 'Generation stopped'                    // No tokens received yet
            : lastMessage.content + '\n\n_Generation stopped_',  // Append to partial response
          isStreaming: false                          // Stop real-time updates
        };
      }
      
      return {
        ...prev,
        messages,
        isLoading: false
      };
    });
  }, [state.isLoading, postMessage]);

  // Update chat mode (ask/agent)
  const setMode = useCallback((mode: 'agent' | 'ask') => {
    setState(prev => ({ ...prev, mode }));
  }, []);

  // Handle model selection
  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    postMessage({
      type: 'model:change',
      model: modelId
    });
  }, [postMessage]);

  // Real-time message handler - processes streaming tokens and completion events
  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'chat:stream':
          // Receive and append individual tokens from AI response
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.role === 'assistant') {
              // Replace placeholder or append to existing content
              const newContent = lastMessage.content === 'Thinking...' 
                ? message.token                           // First token replaces placeholder
                : lastMessage.content + message.token;    // Subsequent tokens append
              
              messages[messages.length - 1] = {
                ...lastMessage,
                content: newContent,                      // Updated content triggers re-render
                isStreaming: true                         // Maintains streaming state
              };
            }
            
            return { ...prev, messages };                // Triggers React update
          });
          break;

        case 'chat:done':
          // Streaming complete - finalize message and clear loading state
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.role === 'assistant') {
              messages[messages.length - 1] = {
                ...lastMessage,
                content: message.text,                    // Final complete text
                isStreaming: false                        // Stop streaming updates
              };
            }
            
            return {
              ...prev,
              messages,
              isLoading: false                           // Re-enable input, hide loading
            };
          });
          break;

        case 'chat:error':
          // Handle streaming or API errors
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
              // Update existing streaming message with error
              messages[messages.length - 1] = {
                ...lastMessage,
                content: `Error: ${message.error}`,     // Replace content with error message
                isStreaming: false                       // Stop streaming state
              };
            } else {
              // Create new error message if no streaming message exists
              messages.push({
                id: generateMessageId(),
                content: `Error: ${message.error}`,
                role: 'assistant',
                timestamp: Date.now(),
                isStreaming: false
              });
            }
            
            return {
              ...prev,
              messages,
              isLoading: false                           // Clear loading state on error
            };
          });
          break;

        case 'chat:stopped':
          // Confirm manual stop completed - clear loading state
          setState(prev => ({
            ...prev,
            isLoading: false                             // Re-enable UI after stop
          }));
          break;

        case 'model:list':
          // Update available models
          setAvailableModels(message.models);
          
          // Auto-select preferred model only on first load
          if (message.models.length > 0 && !hasAutoSelectedModel.current) {
            // Priority order: gpt-4.1 > gpt-4o > gpt-4 > claude-sonnet-4 > o3-mini
            const preferredModel = 
              message.models.find(m => m.id === 'gpt-4.1') ||
              message.models.find(m => m.id === 'gpt-4o') ||
              message.models.find(m => m.id === 'gpt-4') ||
              message.models.find(m => m.id === 'claude-sonnet-4') ||
              message.models.find(m => m.id === 'o3-mini') ||
              message.models[0]; // Fallback to first available
              
            if (preferredModel) {
              setSelectedModel(preferredModel.id);
            }
            hasAutoSelectedModel.current = true;
          }
          break;

        default:
          break;
      }
    });

    return unsubscribe;                                  // Cleanup listener on unmount
  }, [onMessage, generateMessageId]);

  return {
    ...state,
    sendMessage,
    stopGeneration,
    setMode,
    availableModels,
    selectedModel,
    onModelChange: handleModelChange
  };
};