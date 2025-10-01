import { useState, useCallback, useEffect, useRef } from 'react';
import { ChatMessage, ChatState, ModelInfo, McpServer } from '../../types/chat';
import { useVSCode } from '../context/VSCodeContext';

/**
 * Chat state management hook - handles AI streaming and real-time UI updates
 */
export const useChat = () => {
  const { postMessage, onMessage } = useVSCode();

  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false, // Tracks active AI generation for UI state
    mode: "ask",
    contextFiles: [], // Context files state
  });

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(''); // Start empty until models load
  const hasAutoSelectedModel = useRef(false); // Track if we've done initial auto-selection

  // MCP state
  const [mcpEnabled, setMcpEnabled] = useState<boolean>(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [selectedServers, setSelectedServers] = useState<string[]>([]);

  // Generate unique message IDs
  const generateMessageId = useCallback(() => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);


  // Simple chat history functionality
  const saveCurrentChatToHistory = useCallback(() => {
    console.log('=== ATTEMPTING TO SAVE CHAT ===');
    console.log('Current messages length:', state.messages.length);
    
    if (state.messages.length === 0) {
      console.log('No messages to save, skipping');
      return;
    }
    
    try {
      const existingHistory = JSON.parse(localStorage.getItem('paypilot-chat-history') || '[]');
      console.log('Existing history length:', existingHistory.length);
      
      const chatSession = {
        id: `chat_${Date.now()}`,
        messages: state.messages,
        timestamp: Date.now(),
        title: state.messages[0]?.content.slice(0, 50) + '...' || 'New Chat'
      };
      
      console.log('Created chat session:', chatSession.title);
      
      existingHistory.unshift(chatSession); // Add to beginning
      
      // Keep only last 10 chats
      if (existingHistory.length > 10) {
        existingHistory.splice(10);
      }
      
      localStorage.setItem('paypilot-chat-history', JSON.stringify(existingHistory));
      console.log('=== CHAT SAVED TO LOCALSTORAGE ===');
      console.log('New history length:', existingHistory.length);
    } catch (error) {
      console.error('Failed to save chat history:', error);
    }
  }, [state.messages]);

  const getChatHistory = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem('paypilot-chat-history') || '[]');
    } catch (error) {
      console.warn('Failed to load chat history:', error);
      return [];
    }

  const findActiveAssistantMessageIndex = useCallback((messages: ChatMessage[]) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const entry = messages[index];
      if (
        entry.role === 'assistant' &&
        !entry.isWorking &&
        !entry.codeApplied &&
        !entry.toolActivity
      ) {
        return index;
      }
    }
    return -1;

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

    // For agent mode, don't add the assistant message yet - wait for working message
    // For ask mode, add the thinking placeholder
    const assistantMessage: ChatMessage | null = mode === 'ask' ? {
      id: generateMessageId(),
      content: 'Thinking...',           // Placeholder until first token arrives
      role: 'assistant',
      timestamp: Date.now(),
      isStreaming: true                 // Enables real-time content updates
    } : null;

      // Update state with user message and optional assistant placeholder
      const newMessages = assistantMessage
        ? [userMessage, assistantMessage]
        : [userMessage];

      setState((prev) => ({
      ...prev,
        messages: [...prev.messages, ...newMessages],
        isLoading: true,
        mode,
    }));

    // Trigger AI request - will result in streaming tokens
    postMessage({
      type: 'chat:ask',
      prompt: prompt.trim(),
        mode,
        model: selectedModel,
        contextFiles: state.contextFiles, // Include context files in message
    });
    },
    [
      state.isLoading,
      selectedModel,
      postMessage,
      generateMessageId,
      state.contextFiles,
    ] // Add contextFiles to dependencies
  );

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
    },
    [postMessage]
  );

  // Handle context file requests
  const handleAddContext = useCallback(() => {
    postMessage({ type: "context:request" });
  }, [postMessage]);

  // Remove a context file
  const removeContextFile = useCallback(
    (filePath: string) => {
      setState((prev) => ({
        ...prev,
        contextFiles: prev.contextFiles.filter(
          (file) => file.filePath !== filePath
        ),
      }));
      postMessage({ type: "context:remove", filePath });
    },
    [postMessage]
  );

  // Clear all context files
  const clearAllContext = useCallback(() => {
    setState((prev) => ({ ...prev, contextFiles: [] }));
    postMessage({ type: "context:clear" });
  }, [postMessage]);

  // MCP functionality
  const handleMcpToggle = useCallback((enabled: boolean) => {
    setMcpEnabled(enabled);
    postMessage({ type: 'mcp:toggle', enabled });
  }, [postMessage]);

  const handleMcpInfo = useCallback(() => {
    postMessage({ type: 'mcp:get' });
  }, [postMessage]);

  const handleServerSelection = useCallback(
    (servers: string[]) => {
      setSelectedServers(servers);
      // Automatically enable MCP when servers are selected, disable when none
      const shouldEnable = servers.length > 0;
      if (shouldEnable !== mcpEnabled) {
        setMcpEnabled(shouldEnable);
        postMessage({ type: 'mcp:toggle', enabled: shouldEnable });
      }
    },
    [mcpEnabled, postMessage]
  );

  // Handle new chat
  const handleNewChat = useCallback(() => {
    // Save current chat to history before starting new one
    saveCurrentChatToHistory();
    
    // Clear current chat messages
    setState((prev) => ({
      ...prev,
      messages: [],
    }));

    // Send message to extension (if needed for backend sync)
    postMessage({ type: 'chat:new' });
  }, [postMessage, saveCurrentChatToHistory]);

  // Handle chat history
  const handleChatHistory = useCallback(() => {
    console.log('=== HISTORY BUTTON CLICKED ===');
    const history = getChatHistory();
    console.log('Chat History:', history);
    console.log('History length:', history.length);
    
    // Show history in a simple alert for now
    if (history.length === 0) {
      console.log('No history found, showing alert');
      alert('No chat history found. Start a conversation and try again!');
    } else {
      console.log('Found history, creating list');
      const historyList = history.map((chat: any, index: number) => 
        `${index + 1}. ${chat.title} (${new Date(chat.timestamp).toLocaleDateString()})`
      ).join('\n');
      
      console.log('History list:', historyList);
      alert(`Chat History (${history.length} chats):\n\n${historyList}`);
    }
    
    // Also send to extension if needed
    postMessage({ type: 'chat:history' });
    
    return history;
  }, [postMessage, getChatHistory]);

  // Load MCP servers on mount
  useEffect(() => {
    postMessage({ type: 'mcp:get' });
  }, [postMessage]);

  // Real-time message handler - processes streaming tokens and completion events
  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'chat:working':
          // Add working message for agent mode
          setState(prev => {
            const messages = [...prev.messages];
            const workingMessage: ChatMessage = {
              id: generateMessageId(),
              content: message.message,
              role: 'assistant',
              timestamp: Date.now(),
              isWorking: true,
            };
            messages.push(workingMessage);
            return { ...prev, messages, isLoading: true };
          });
          break;

        case 'chat:code-applied':
          // Handle code applied messages - create separate cards for each file
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.isWorking) {
              // Replace working message with first code applied card
              messages[messages.length - 1] = {
                ...lastMessage,
                content: 'Code changes applied',
                isWorking: false,
                codeApplied: {
                  fileName: message.fileName,
                  filePath: message.filePath,
                  linesAdded: message.linesAdded,
                  linesDeleted: message.linesDeleted,
                  explanation: message.explanation,
                  operation: message.operation
                }
              };
            } else {
              // Add additional code applied cards for subsequent files
              const newMessage: ChatMessage = {
                id: generateMessageId(),
                content: 'Code changes applied',
                role: 'assistant',
                timestamp: Date.now(),
                codeApplied: {
                  fileName: message.fileName,
                  filePath: message.filePath,
                  linesAdded: message.linesAdded,
                  linesDeleted: message.linesDeleted,
                  explanation: message.explanation,
                  operation: message.operation
                }
              };
              messages.push(newMessage);
            }
            
            return { ...prev, messages, isLoading: false };
          });
          break;

        case 'chat:agent-summary':
          setState(prev => {
            const messages = [...prev.messages];
            messages.push({
              id: generateMessageId(),
              content: message.text ?? '',
              role: 'assistant',
              timestamp: Date.now(),
            });
            return {
              ...prev,
              messages,
            };
          });
          break;

        case 'chat:tool-activity':
          setState(prev => {
            const messages = [...prev.messages];
            const activityMessage: ChatMessage = {
              id: generateMessageId(),
              content: message.title ?? 'Tool activity',
              role: 'assistant',
              timestamp: Date.now(),
              toolActivity: {
                title: message.title ?? 'Tool activity',
                detail: message.detail,
                filePath: message.filePath,
                operation: message.operation,
              },
            };

            if (messages.length > 0 && messages[messages.length - 1].isWorking) {
              messages[messages.length - 1] = activityMessage;
            } else {
              const targetIndex = findActiveAssistantMessageIndex(messages);
              if (targetIndex >= 0) {
                messages.splice(targetIndex, 0, activityMessage);
              } else {
                messages.push(activityMessage);
              }
            }

            return {
              ...prev,
              messages,
            };
          });
          break;

        case 'chat:stream':
          // Receive and append individual tokens from AI response (ask mode only)
          setState(prev => {
            const messages = [...prev.messages];
            const targetIndex = findActiveAssistantMessageIndex(messages);

            if (targetIndex >= 0) {
              const lastMessage = messages[targetIndex];
              // Replace placeholder or append to existing content
              const newContent = lastMessage.content === 'Thinking...' 
                ? message.token                           // First token replaces placeholder
                : lastMessage.content + message.token;    // Subsequent tokens append
              
              messages[targetIndex] = {
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
            const targetIndex = findActiveAssistantMessageIndex(messages);

            if (targetIndex >= 0) {
              const lastMessage = messages[targetIndex];
              messages[targetIndex] = {
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
            const targetIndex = findActiveAssistantMessageIndex(messages);

            if (targetIndex >= 0) {
              const lastMessage = messages[targetIndex];
              // Update existing streaming message with error
              messages[targetIndex] = {
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

        case "context:list":
          // Handle context files list update (replace all)
          setState((prev) => ({
            ...prev,
            contextFiles: message.files,
          }));
          break;

        case "context:add":
          // Handle adding new context files (merge with existing)
          setState((prev) => {
            const existingPaths = new Set(
              prev.contextFiles.map((f) => f.filePath)
            );
            const newFiles = message.files.filter(
              (f) => !existingPaths.has(f.filePath)
            );

            return {
              ...prev,
              contextFiles: [...prev.contextFiles, ...newFiles],
            };
          });
          break;

        case "context:file-picker":
          // File picker opened - no UI state change needed
          break;

        case "mcp:servers":
          // Handle MCP servers list response
          setMcpServers(message.servers);
          break;

        default:
          break;
      }
    });

    return unsubscribe;                                  // Cleanup listener on unmount
  }, [onMessage, generateMessageId, findActiveAssistantMessageIndex]);

  // Auto-save chat history when messages change (debounced)
  useEffect(() => {
    console.log('=== AUTO-SAVE EFFECT TRIGGERED ===');
    console.log('Messages length:', state.messages.length);
    
    if (state.messages.length === 0) {
      console.log('No messages, skipping auto-save');
      return;
    }
    
    console.log('Setting up auto-save timeout (2 seconds)');
    const timeoutId = setTimeout(() => {
      console.log('Auto-save timeout executed');
      saveCurrentChatToHistory();
    }, 2000); // Save 2 seconds after the last message change
    
    return () => {
      console.log('Clearing auto-save timeout');
      clearTimeout(timeoutId);
    };
  }, [state.messages, saveCurrentChatToHistory]);

  return {
    ...state,
    sendMessage,
    stopGeneration,
    setMode,
    availableModels,
    selectedModel,
    onModelChange: handleModelChange,
    contextFiles: state.contextFiles,
    handleAddContext,
    removeContextFile,
    clearAllContext,
    mcpEnabled,
    onMcpToggle: handleMcpToggle,
    mcpServers,
    selectedServers,
    onServerSelection: handleServerSelection,
    onMcpInfo: handleMcpInfo,
    handleNewChat,
    handleChatHistory,
  };
};
