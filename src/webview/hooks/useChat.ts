import { useState, useCallback, useEffect } from 'react';
import { ChatMessage, ChatState } from '../../types/chat';
import { useVSCode } from '../context/VSCodeContext';

/**
 * CHAT STATE MANAGEMENT HOOK
 * 
 * This is the central state management hub for the entire chat interface. It orchestrates
 * all chat interactions, message handling, and mode management.
 */
export const useChat = () => {
  // Get VS Code communication functions from context
  const { postMessage, onMessage } = useVSCode();
  
  // Main chat state
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false,
    mode: 'ask'
  });

  /**
   * Generate a unique ID for messages
   */
  const generateMessageId = useCallback(() => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Send a chat message to the extension
   */
  const sendMessage = useCallback((prompt: string, mode: 'agent' | 'ask') => {
    if (!prompt.trim() || state.isLoading) return;

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      content: prompt.trim(),
      role: 'user',
      timestamp: Date.now()
    };

    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      content: 'Thinking...',
      role: 'assistant',
      timestamp: Date.now(),
      isStreaming: true
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage, assistantMessage],
      isLoading: true
    }));

    // Send message to extension.ts with mode information
    postMessage({
      type: 'chat:ask',
      prompt: prompt.trim(),
      mode
    });
  }, [state.isLoading, generateMessageId, postMessage]);

  /**
   * Stop the current AI generation
   */
  const stopGeneration = useCallback(() => {
    if (!state.isLoading) return;

    // Send stop message to extension
    postMessage({
      type: 'chat:stop'
    });

    // Update state to indicate generation stopped
    setState(prev => {
      const messages = [...prev.messages];
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
        messages[messages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content === 'Thinking...' 
            ? 'Generation stopped' 
            : lastMessage.content + '\n\n_Generation stopped_',
          isStreaming: false
        };
      }
      
      return {
        ...prev,
        messages,
        isLoading: false
      };
    });
  }, [state.isLoading, postMessage]);

  /**
   * Set the current mode
   */
  const setMode = useCallback((mode: 'agent' | 'ask') => {
    setState(prev => ({ ...prev, mode }));
  }, []);

  /**
   * Listen for messages from the extension
   */
  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'chat:stream':
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.role === 'assistant') {
              const newContent = lastMessage.content === 'Thinking...' 
                ? message.token 
                : lastMessage.content + message.token;
              
              messages[messages.length - 1] = {
                ...lastMessage,
                content: newContent,
                isStreaming: true
              };
            }
            
            return { ...prev, messages };
          });
          break;

        case 'chat:done':
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.role === 'assistant') {
              messages[messages.length - 1] = {
                ...lastMessage,
                content: message.text,
                isStreaming: false
              };
            }
            
            return {
              ...prev,
              messages,
              isLoading: false
            };
          });
          break;

        case 'chat:error':
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
              messages[messages.length - 1] = {
                ...lastMessage,
                content: `Error: ${message.error}`,
                isStreaming: false
              };
            } else {
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
              isLoading: false
            };
          });
          break;

        case 'chat:stopped':
          setState(prev => ({
            ...prev,
            isLoading: false
          }));
          break;

        default:
          break;
      }
    });

    return unsubscribe;
  }, [onMessage, generateMessageId]);

  return {
    ...state,
    sendMessage,
    stopGeneration,
    setMode
  };
};