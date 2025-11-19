import { useState, useCallback, useEffect, useRef } from 'react';
import { ChatMessage, ChatState } from '../../features/chat/messages';
import { ModelInfo } from '../../features/language-model/types';
import { useVSCode } from '../context/VSCodeContext';

/**
 * Chat state management hook - handles AI streaming and real-time UI updates
 */
export const useChat = (ragEnabled: boolean = false) => {
  const { postMessage, onMessage } = useVSCode();

  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false, // Tracks active AI generation for UI state
    mode: "ask",
    contextFiles: [], // Context files state
  });

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(''); // Start empty until models load
  const [selectedModelSource, setSelectedModelSource] = useState<'vscode' | 'backend'>('vscode');
  const hasAutoSelectedModel = useRef(false); // Track if we've done initial auto-selection

  // Chat history modal state
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  
  // Current chat session tracking
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [lastSavedMessageCount, setLastSavedMessageCount] = useState<number>(0);

  // Generate unique message IDs
  const generateMessageId = useCallback(() => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);


  // Smart chat history functionality with deduplication
  const saveCurrentChatToHistory = useCallback(() => {
    console.log('=== ATTEMPTING TO SAVE CHAT ===');
    console.log('Current messages length:', state.messages.length);
    console.log('Current chat ID:', currentChatId);
    console.log('Last saved message count:', lastSavedMessageCount);
    
    if (state.messages.length === 0) {
      console.log('No messages to save, skipping');
      return;
    }
    
    // Don't save if we haven't added any new messages since last save
    if (state.messages.length === lastSavedMessageCount && currentChatId) {
      console.log('No new messages since last save, skipping duplicate');
      return;
    }
    
    try {
      const existingHistory = JSON.parse(localStorage.getItem('paypilot-chat-history') || '[]');
      console.log('Existing history length:', existingHistory.length);
      
      let chatSession;
      let updatedHistory = [...existingHistory];
      
      if (currentChatId) {
        // Update existing chat session
        const existingIndex = updatedHistory.findIndex(chat => chat.id === currentChatId);
        if (existingIndex !== -1) {
          console.log('Updating existing chat session');
          chatSession = {
            ...updatedHistory[existingIndex],
            messages: state.messages,
            timestamp: Date.now(), // Update timestamp for sorting
            title: state.messages[0]?.content.slice(0, 50) + '...' || 'New Chat'
          };
          updatedHistory[existingIndex] = chatSession;
          // Move updated chat to top
          updatedHistory.splice(existingIndex, 1);
          updatedHistory.unshift(chatSession);
        } else {
          // Chat ID exists but not found in history, create new
          console.log('Chat ID not found in history, creating new');
          chatSession = {
            id: currentChatId,
            messages: state.messages,
            timestamp: Date.now(),
            title: state.messages[0]?.content.slice(0, 50) + '...' || 'New Chat'
          };
          updatedHistory.unshift(chatSession);
        }
      } else {
        // Create new chat session
        const newChatId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        console.log('Creating new chat session with ID:', newChatId);
        chatSession = {
          id: newChatId,
          messages: state.messages,
          timestamp: Date.now(),
          title: state.messages[0]?.content.slice(0, 50) + '...' || 'New Chat'
        };
        updatedHistory.unshift(chatSession);
        setCurrentChatId(newChatId);
      }
      
      // Keep only last 10 chats
      if (updatedHistory.length > 10) {
        updatedHistory.splice(10);
      }
      
      localStorage.setItem('paypilot-chat-history', JSON.stringify(updatedHistory));
      setLastSavedMessageCount(state.messages.length);
      setChatHistory(updatedHistory); // Update state to trigger re-renders
      
      console.log('=== CHAT SAVED TO LOCALSTORAGE ===');
      console.log('Chat title:', chatSession.title);
      console.log('Messages saved:', state.messages.length);
      console.log('History length:', updatedHistory.length);
    } catch (error) {
      console.error('Failed to save chat history:', error);
    }
  }, [state.messages, currentChatId, lastSavedMessageCount]);

  const getChatHistory = useCallback(() => {
    try {
      const history = JSON.parse(localStorage.getItem('paypilot-chat-history') || '[]');
      setChatHistory(history);
      return history;
    } catch (error) {
      console.warn('Failed to load chat history:', error);
      const emptyHistory: any[] = [];
      setChatHistory(emptyHistory);
      return emptyHistory;
    }
  }, []);

  // Refresh chat history from localStorage
  const refreshChatHistory = useCallback(() => {
    getChatHistory();
  }, [getChatHistory]);

  const findActiveAssistantMessageIndex = useCallback((messages: ChatMessage[]) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const entry = messages[index];
      if (
        entry.role === 'assistant' &&
        !entry.isWorking &&
        !entry.agentPlan &&
        !entry.codeApplied &&
        !entry.toolActivity
      ) {
        return index;
      }
    }
    return -1;

  }, []);

  const findWorkingMessageIndex = useCallback((messages: ChatMessage[]) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].isWorking) {
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
    let assistantMessage: ChatMessage | null = null;
    if (mode === "ask") {
      assistantMessage = {
        id: generateMessageId(),
        content: "Thinking...",
        role: "assistant",
        timestamp: Date.now(),
        isStreaming: true,
      };
    } else {
      assistantMessage = {
        id: generateMessageId(),
        content: "",
        role: "assistant",
        timestamp: Date.now(),
        isThinking: true,
      };
    }

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
      type: 'chat:query',
      prompt: prompt.trim(),
        mode,
        model: selectedModel,
        source: selectedModelSource,
        contextFiles: state.contextFiles, // Include context files in message
    });
    },
    [
      state.isLoading,
      selectedModel,
      selectedModelSource,
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
    const model = availableModels.find((m) => m.id === modelId);
    const source: 'vscode' | 'backend' =
      model?.source === 'backend' ? 'backend' : 'vscode';
    setSelectedModel(modelId);
    setSelectedModelSource(source);
    postMessage({
      type: 'model:change',
      model: modelId,
      source,
    });
    },
    [postMessage, availableModels]
  );

  useEffect(() => {
    const desiredSource: 'vscode' | 'backend' = ragEnabled ? 'backend' : 'vscode';
    const allowedModels = availableModels.filter((model) =>
      desiredSource === 'backend'
        ? model.source === 'backend'
        : !model.source || model.source === 'vscode'
    );
    const hasDesiredSelection =
      selectedModel !== '' &&
      allowedModels.some((model) => model.id === selectedModel);

    if (!hasDesiredSelection) {
      if (allowedModels.length > 0) {
        handleModelChange(allowedModels[0].id);
      } else {
        if (selectedModel !== '') {
          setSelectedModel('');
        }
        if (selectedModelSource !== desiredSource) {
          setSelectedModelSource(desiredSource);
        }
      }
    } else if (selectedModelSource !== desiredSource) {
      setSelectedModelSource(desiredSource);
    }
  }, [
    ragEnabled,
    availableModels,
    selectedModel,
    selectedModelSource,
    handleModelChange,
  ]);

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

  // Handle new chat
  const handleNewChat = useCallback(() => {
    // Save current chat to history before starting new one
    if (state.messages.length > 0) {
      saveCurrentChatToHistory();
    }
    
    // Reset session tracking
    setCurrentChatId(null);
    setLastSavedMessageCount(0);
    
    // Clear current chat messages
    setState((prev) => ({
      ...prev,
      messages: [],
    }));

    console.log('=== NEW CHAT STARTED ===');
  }, [postMessage, saveCurrentChatToHistory, state.messages.length]);

  // Handle chat history
  const handleChatHistory = useCallback(() => {
    console.log('=== HISTORY BUTTON CLICKED ===');
    // Auto-save current chat if it has content and hasn't been saved recently
    if (state.messages.length > 0 && state.messages.length !== lastSavedMessageCount) {
      saveCurrentChatToHistory();
    }
    setShowHistoryModal(true);
  }, [state.messages.length, lastSavedMessageCount, saveCurrentChatToHistory]);

  // Load a chat from history
  const handleLoadChat = useCallback((chat: any) => {
    console.log('=== LOADING CHAT FROM HISTORY ===');
    console.log('Loading chat:', chat.title);
    
    // Save current chat to history before loading new one (only if different)
    if (state.messages.length > 0 && currentChatId !== chat.id) {
      saveCurrentChatToHistory();
    }
    
    // Set session to loaded chat
    setCurrentChatId(chat.id);
    setLastSavedMessageCount(chat.messages?.length || 0);
    
    // Load the selected chat messages
    setState((prev) => ({
      ...prev,
      messages: chat.messages || [],
    }));
    
    console.log('Chat loaded with', chat.messages?.length || 0, 'messages');
    console.log('Set current chat ID to:', chat.id);
  }, [state.messages, saveCurrentChatToHistory, currentChatId]);

  // Delete a chat from history
  const handleDeleteChat = useCallback((chatId: string) => {
    console.log('=== DELETING CHAT FROM HISTORY ===');
    console.log('Deleting chat ID:', chatId);
    console.log('Current chat history length:', chatHistory.length);
    
    try {
      const existingHistory = JSON.parse(localStorage.getItem('paypilot-chat-history') || '[]');
      const updatedHistory = existingHistory.filter((chat: any) => chat.id !== chatId);
      localStorage.setItem('paypilot-chat-history', JSON.stringify(updatedHistory));
      setChatHistory(updatedHistory); // Update state to trigger re-render
      
      // If we deleted the currently active chat, reset the session
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setLastSavedMessageCount(0);
      }
      
      console.log('Chat deleted successfully');
      console.log('Remaining chats:', updatedHistory.length);
    } catch (error) {
      console.error('Failed to delete chat:', error);
    }
  }, [currentChatId]);

  // Clean up duplicate entries in localStorage (utility function)
  const cleanupDuplicateHistory = useCallback(() => {
    console.log('=== CLEANING UP DUPLICATE HISTORY ===');
    
    try {
      const existingHistory = JSON.parse(localStorage.getItem('paypilot-chat-history') || '[]');
      console.log('Original history length:', existingHistory.length);
      
      // Remove duplicates based on content similarity and timestamp proximity
      const cleaned = existingHistory.filter((chat: any, index: number) => {
        const isDuplicate = existingHistory.slice(0, index).some((otherChat: any) => {
          // Check if chats have same title and similar message count
          const sameTitle = chat.title === otherChat.title;
          const similarMessageCount = Math.abs(chat.messages.length - otherChat.messages.length) <= 2;
          const closeTimestamp = Math.abs(chat.timestamp - otherChat.timestamp) < 300000; // 5 minutes
          
          return sameTitle && similarMessageCount && closeTimestamp;
        });
        
        return !isDuplicate;
      });
      
      console.log('Cleaned history length:', cleaned.length);
      console.log('Removed', existingHistory.length - cleaned.length, 'duplicates');
      
      localStorage.setItem('paypilot-chat-history', JSON.stringify(cleaned));
      setChatHistory(cleaned); // Update state to trigger re-render
      return cleaned.length;
    } catch (error) {
      console.error('Failed to cleanup history:', error);
      return 0;
    }
  }, []);

  // Load chat history on mount
  useEffect(() => {
    refreshChatHistory();
  }, [refreshChatHistory]);

  // Real-time message handler - processes streaming tokens and completion events
  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'chat:working':
          // Add working message for agent mode
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];

            if (lastMessage && lastMessage.isThinking) {
              messages[messages.length - 1] = {
                ...lastMessage,
                content: message.message,
                isThinking: false,
                isStreaming: false,
                isWorking: true,
              };
            } else {
              const workingMessage: ChatMessage = {
                id: generateMessageId(),
                content: message.message,
                role: "assistant",
                timestamp: Date.now(),
                isWorking: true,
              };
              messages.push(workingMessage);
            }
            return { ...prev, messages, isLoading: true };
          });
          break;

        case 'chat:code-applied':
          // Handle code applied messages - create separate cards for each file
          setState(prev => {
            const messages = [...prev.messages];
            const codeMessage: ChatMessage = {
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

            const workingIndex = findWorkingMessageIndex(messages);
            if (workingIndex >= 0) {
              messages.splice(workingIndex, 0, codeMessage);
            } else {
              messages.push(codeMessage);
            }
            
            return { ...prev, messages };
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

        case 'chat:agent-plan':
          if (Array.isArray(message.steps) && message.steps.length > 0) {
            setState((prev) => {
              const messages = [...prev.messages];
              const planMessage: ChatMessage = {
                id: generateMessageId(),
                content: message.title ?? "Agent plan",
                role: "assistant",
                timestamp: Date.now(),
                agentPlan: {
                  title: message.title ?? "Agent plan",
                  steps: message.steps,
                },
              };

              const lastPlanIndex = (() => {
                for (let index = messages.length - 1; index >= 0; index -= 1) {
                  if (messages[index].agentPlan) {
                    return index;
                  }
                }
                return -1;
              })();

              if (lastPlanIndex >= 0) {
                messages[lastPlanIndex] = planMessage;
              } else {
                messages.push(planMessage);
              }

              return { ...prev, messages };
            });
          }
          break;

        case "chat:multi-file-edit-summary":
          setState((prev) => {
            const messages = [...prev.messages];
            messages.push({
              id: generateMessageId(),
              content: "Multi-file edit summary",
              role: "assistant",
              timestamp: Date.now(),
              multiFileEditSummary: {
                changes: message.changes || [],
                totalLinesAdded: message.totalLinesAdded || 0,
                totalLinesDeleted: message.totalLinesDeleted || 0,
              },
            });
            return {
              ...prev,
              messages,
            };
          });
          break;

        case "chat:tool-activity":
          setState((prev) => {
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

            const workingIndex = findWorkingMessageIndex(messages);
            if (workingIndex >= 0) {
              messages.splice(workingIndex, 0, activityMessage);
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
            let messages = [...prev.messages];
            const targetIndex = findActiveAssistantMessageIndex(messages);

            if (targetIndex >= 0) {
              // Update existing message
              const lastMessage = messages[targetIndex];
              messages[targetIndex] = {
                ...lastMessage,
                content: message.text,                        // Final complete text
                isStreaming: false                        // Stop streaming updates
              };
            } else if (message.text) {
              messages.push({
                id: generateMessageId(),
                content: message.text,
                role: 'assistant',
                timestamp: Date.now(),
                isStreaming: false
              });
            }

            messages = messages.filter((msg) => !msg.isWorking);

            return {
              ...prev,
              messages,
              isLoading: false
            };
          });
          break;

        case 'chat:error':
          // Handle streaming or API errors
          setState(prev => {
            let messages = [...prev.messages];
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
            
            messages = messages.filter((msg) => !msg.isWorking);

            return {
              ...prev,
              messages,
              isLoading: false                           // Clear loading state on error
            };
          });
          break;

        case 'chat:stopped':
          // Confirm manual stop completed - clear loading state
          setState(prev => {
            const messages = prev.messages.filter((msg) => !msg.isWorking);
            return {
              ...prev,
              messages,
              isLoading: false,
            };
          });
          break;

        case 'model:list':
          // Update available models
          setAvailableModels(message.models);
          
          // Auto-select preferred model only on first load
          if (message.models.length > 0 && !hasAutoSelectedModel.current) {
            const preferredModel =
              message.models.find(m => m.id === 'gpt-4.1') ||
              message.models.find(m => m.id === 'gpt-4o') ||
              message.models.find(m => m.id === 'gpt-4o-mini') ||
              message.models.find(m => m.id === 'gpt-4') ||
              message.models.find(m => m.id === 'claude-sonnet-4') ||
              message.models.find(m => m.id === 'o3-mini') ||
              message.models.find((m) => !m.source || m.source === 'vscode') ||
              message.models[0]; // Fallback to first available
              
            if (preferredModel) {
              setSelectedModel(preferredModel.id);
              setSelectedModelSource(
                preferredModel.source === 'backend' ? 'backend' : 'vscode'
              );
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

        default:
          break;
      }
    });

    return unsubscribe;                                  // Cleanup listener on unmount
  }, [onMessage, generateMessageId, findActiveAssistantMessageIndex, findWorkingMessageIndex]);

  // Auto-save chat history when messages change (debounced and intelligent)
  useEffect(() => {
    console.log('=== AUTO-SAVE EFFECT TRIGGERED ===');
    console.log('Messages length:', state.messages.length);
    console.log('Last saved count:', lastSavedMessageCount);
    
    if (state.messages.length === 0) {
      console.log('No messages, skipping auto-save');
      return;
    }
    
    // Only auto-save if we have new messages since last save
    if (state.messages.length === lastSavedMessageCount) {
      console.log('No new messages since last save, skipping auto-save');
      return;
    }
    
    // Only auto-save if chat has at least 2 messages (conversation started)
    if (state.messages.length < 2) {
      console.log('Not enough messages for auto-save, skipping');
      return;
    }
    
    console.log('Setting up auto-save timeout (5 seconds)');
    const timeoutId = setTimeout(() => {
      console.log('Auto-save timeout executed');
      saveCurrentChatToHistory();
    }, 5000); // Increased to 5 seconds to reduce frequency
    
    return () => {
      console.log('Clearing auto-save timeout');
      clearTimeout(timeoutId);
    };
  }, [state.messages.length, saveCurrentChatToHistory, lastSavedMessageCount]); // Only depend on message count, not content

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
    handleNewChat,
    handleChatHistory,
    showHistoryModal,
    setShowHistoryModal,
    getChatHistory,
    chatHistory,
    refreshChatHistory,
    handleLoadChat,
    handleDeleteChat,
    cleanupDuplicateHistory,
    currentChatId,
    lastSavedMessageCount,
  };
};
