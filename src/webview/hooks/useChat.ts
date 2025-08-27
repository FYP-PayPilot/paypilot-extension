import { useState, useCallback, useEffect } from 'react';
import { ChatMessage, ChatState } from '../../types/chat';
import { useVSCode } from '../context/VSCodeContext';

/**
 * CHAT STATE MANAGEMENT HOOK
 * 
 * This is the central state management hub for the entire chat interface. It orchestrates
 * all chat interactions, message handling, and code application features while maintaining
 * clean separation between UI components and business logic.
 * 
 * ARCHITECTURAL ROLE:
 * - Centralizes all chat-related state and logic in one place
 * - Provides a clean interface for components to interact with the AI service
 * - Manages real-time streaming responses from the DeepSeek API
 * - Handles code detection and application workflows
 * - Bridges React state management with VS Code extension communication
 * 
 * INTEGRATION WITH EXTENSION SYSTEM:
 * → OUTBOUND: useChat → useVSCode → VSCodeProvider → extension.ts → DeepSeek API
 * ← INBOUND: DeepSeek API → extension.ts → VSCodeProvider → useVSCode → useChat → UI
 * 
 * COMPONENT INTEGRATION:
 * - Chat.tsx: Uses this hook for overall chat state and actions
 * - ChatMessage.tsx: Receives messages array for rendering
 * - ChatInput.tsx: Uses sendMessage function for user input
 * - ActionButtons.tsx: Uses code application functions and canApplyCode state
 * 
 * STATE MANAGEMENT PATTERN:
 * Uses React's useState for local state with useCallback for performance optimization.
 * All state changes are immutable to ensure proper React re-rendering and debugging.
 * 
 * REAL-TIME FEATURES:
 * - Streaming message updates as AI types responses
 * - Live code block detection for enabling action buttons
 * - Immediate UI feedback for user actions
 */

/**
 * Custom hook for managing chat state and interactions
 * 
 * This hook encapsulates all chat functionality including message management,
 * AI communication, and code application features. It provides a comprehensive
 * interface for the chat UI while handling the complexity of real-time communication.
 * 
 * FEATURES PROVIDED:
 * 1. Message Management: Send, receive, and display chat messages
 * 2. Streaming Support: Handle real-time AI response streaming
 * 3. Code Detection: Parse and identify code blocks in AI responses
 * 4. Code Application: Apply AI-generated code to VS Code files
 * 5. Error Handling: Graceful error management and user feedback
 * 
 * @returns Object containing chat state and interaction functions
 */
export const useChat = () => {
  // Get VS Code communication functions from context
  // This enables sending messages to extension.ts and receiving responses
  const { postMessage, onMessage } = useVSCode();
  
  // Main chat state containing all chat-related data
  // Uses ChatState interface from src/types/chat.ts for type safety
  const [state, setState] = useState<ChatState>({
    messages: [],                    // Array of all chat messages (user + AI)
    isLoading: false,               // Whether AI is currently processing a request
    lastAssistantMessage: '',       // Most recent AI response (for code application)
    canApplyCode: false            // Whether the last response contains applicable code
  });

  /**
   * Generate a unique ID for messages
   * 
   * Creates unique identifiers for chat messages to enable efficient React rendering
   * and message tracking. Uses timestamp + random string for collision resistance.
   * 
   * USAGE: Each ChatMessage component needs a unique key for React's reconciliation
   * 
   * @returns Unique string identifier for message objects
   */
  const generateMessageId = useCallback(() => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Parse code blocks from text to determine if code can be applied
   * 
   * Analyzes AI responses to detect code blocks that can be applied to VS Code files.
   * This enables the ActionButtons component to show/hide apply options dynamically.
   * 
   * CODE BLOCK DETECTION PATTERN:
   * - Matches ```language\ncode\n``` format (standard markdown)
   * - Supports various programming languages
   * - Ensures code content is not empty after trimming
   * 
   * INTEGRATION:
   * - Called when AI responses complete (chat:done message)
   * - Result updates canApplyCode state
   * - ActionButtons.tsx uses this state to show/hide buttons
   * 
   * @param text AI response text to analyze
   * @returns Boolean indicating if applicable code was found
   */
  const parseCodeBlocks = useCallback((text: string) => {
    const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/g;
    const matches = [...text.matchAll(codeBlockRegex)];
    return matches.length > 0 && matches.some(match => match[2]?.trim().length > 0);
  }, []);

  /**
   * Send a chat message to the extension
   * 
   * This is the primary function for user-initiated chat interactions. It handles
   * the complete flow from user input to AI response setup.
   * 
   * MESSAGE FLOW:
   * 1. Validate input and check loading state
   * 2. Create user message object and add to state
   * 3. Create placeholder AI message for streaming
   * 4. Send request to extension.ts via postMessage
   * 5. Extension processes via DeepSeek API and streams response back
   * 
   * STATE UPDATES:
   * - Adds user message immediately for instant UI feedback
   * - Adds placeholder assistant message with "Thinking..." text
   * - Sets loading state to disable input during processing
   * - Resets code application state for new conversation
   * 
   * INTEGRATION POINTS:
   * - ChatInput.tsx calls this when user submits input
   * - extension.ts receives 'chat:ask' message and processes
   * - Response streams back through onMessage listener below
   * 
   * @param prompt User's input text to send to AI
   */
  const sendMessage = useCallback((prompt: string) => {
    // Validate input and prevent duplicate requests
    if (!prompt.trim() || state.isLoading) return;

    // Create user message object using ChatMessage interface
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      content: prompt.trim(),
      role: 'user',
      timestamp: Date.now()
    };

    // Create placeholder assistant message for streaming updates
    // This provides immediate UI feedback that AI is processing
    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      content: 'Thinking...',              // Placeholder text shown while waiting
      role: 'assistant',
      timestamp: Date.now(),
      isStreaming: true                     // Flag for streaming indicator UI
    };

    // Update state with both messages and loading indicator
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage, assistantMessage],
      isLoading: true,
      lastAssistantMessage: '',
      canApplyCode: false
    }));

    // Send message to extension.ts for AI processing
    // extension.ts will handle DeepSeek API communication and stream responses back
    postMessage({
      type: 'chat:ask',
      prompt: prompt.trim()
    });
  }, [state.isLoading, generateMessageId, postMessage]);

  /**
   * Apply code to the current selection in the editor
   * 
   * Extracts code from the last AI response and applies it to the user's current
   * text selection in VS Code. This enables quick application of AI suggestions.
   * 
   * CODE EXTRACTION:
   * - Uses regex to find first code block in AI response
   * - Extracts content between ``` markers
   * - Trims whitespace and sends to extension
   * 
   * INTEGRATION WITH VS CODE:
   * - Sends 'editor:applyEdit' message to extension.ts
   * - extension.ts uses VS Code editor API to replace selection
   * - Works with any programming language or text content
   * 
   * ERROR HANDLING:
   * - Validates that code is available before attempting application
   * - extension.ts handles file access errors and user feedback
   */
  const applyToSelection = useCallback(() => {
    if (!state.canApplyCode || !state.lastAssistantMessage) return;

    const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/;
    const match = state.lastAssistantMessage.match(codeBlockRegex);
    
    if (match && match[2]) {
      postMessage({
        type: 'editor:applyEdit',
        payload: {
          mode: 'selection',                  // Replace only selected text
          code: match[2].trim()
        }
      });
    }
  }, [state.canApplyCode, state.lastAssistantMessage, postMessage]);

  /**
   * Replace the entire file with the generated code
   * 
   * Similar to applyToSelection but replaces the entire file content.
   * Useful for complete file rewrites or when working with small files.
   * 
   * USE CASES:
   * - Complete file refactoring
   * - Configuration file generation
   * - Small utility file creation
   * 
   * SAFETY CONSIDERATIONS:
   * - User should be warned about replacing entire file content
   * - VS Code's undo system allows reverting changes
   * - extension.ts could add confirmation dialogs for destructive operations
   */
  const replaceFile = useCallback(() => {
    if (!state.canApplyCode || !state.lastAssistantMessage) return;

    const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/;
    const match = state.lastAssistantMessage.match(codeBlockRegex);
    
    if (match && match[2]) {
      postMessage({
        type: 'editor:applyEdit',
        payload: {
          mode: 'file',                       // Replace entire file content
          code: match[2].trim()
        }
      });
    }
  }, [state.canApplyCode, state.lastAssistantMessage, postMessage]);

  /**
   * Create a new file with the generated code
   * 
   * Creates a completely new file with the AI-generated code content.
   * Provides intelligent filename suggestions based on code content.
   * 
   * FILENAME INTELLIGENCE:
   * - Attempts to extract filename from code comments
   * - Falls back to content-based inference (detects TypeScript, Python, etc.)
   * - Allows user customization before file creation
   * 
   * WORKFLOW:
   * 1. Extract code from AI response
   * 2. Send to extension.ts with 'editor:createFile' message
   * 3. extension.ts analyzes code and suggests filename
   * 4. User can modify filename in VS Code input dialog
   * 5. File is created in current workspace and opened in editor
   */
  const createNewFile = useCallback(() => {
    if (!state.canApplyCode || !state.lastAssistantMessage) return;

    const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/;
    const match = state.lastAssistantMessage.match(codeBlockRegex);
    
    if (match && match[2]) {
      postMessage({
        type: 'editor:createFile',
        payload: {
          code: match[2].trim()
        }
      });
    }
  }, [state.canApplyCode, state.lastAssistantMessage, postMessage]);

  /**
   * Listen for messages from the extension
   * 
   * This effect sets up the response handling for all extension communication.
   * It processes different message types and updates the chat state accordingly.
   * 
   * MESSAGE TYPES HANDLED:
   * 1. 'chat:stream': Real-time AI response tokens for live typing effect
   * 2. 'chat:done': Complete AI response with code block analysis
   * 3. 'chat:error': Error messages from AI service or extension
   * 4. 'editor:applied': Confirmation that code was successfully applied
   * 
   * STREAMING IMPLEMENTATION:
   * - Updates the last assistant message content incrementally
   * - Maintains isStreaming flag for UI indicators
   * - Provides smooth real-time chat experience
   * 
   * ERROR HANDLING:
   * - Displays errors as assistant messages
   * - Maintains chat history even when errors occur
   * - Provides clear feedback to users about what went wrong
   */
  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        /**
         * Handle streaming AI response tokens
         * 
         * Updates the assistant message content in real-time as the AI generates
         * its response. This creates a natural typing effect in the chat interface.
         */
        case 'chat:stream':
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.role === 'assistant') {
              // Update the streaming content
              // Replace "Thinking..." with first token, then append subsequent tokens
              const newContent = lastMessage.content === 'Thinking...' 
                ? message.token 
                : lastMessage.content + message.token;
              
              messages[messages.length - 1] = {
                ...lastMessage,
                content: newContent,
                isStreaming: true
              };
            }
            
            return {
              ...prev,
              messages,
              lastAssistantMessage: messages[messages.length - 1]?.content || ''
            };
          });
          break;

        /**
         * Handle completion of AI response
         * 
         * Finalizes the assistant message, analyzes for code blocks,
         * and updates application state accordingly.
         */
        case 'chat:done':
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.role === 'assistant') {
              messages[messages.length - 1] = {
                ...lastMessage,
                content: message.text,
                isStreaming: false                    // Stop streaming indicator
              };
            }
            
            // Analyze complete response for code blocks
            const canApplyCode = parseCodeBlocks(message.text);
            
            return {
              ...prev,
              messages,
              isLoading: false,
              lastAssistantMessage: message.text,
              canApplyCode                           // Enable/disable action buttons
            };
          });
          break;

        /**
         * Handle AI service or extension errors
         * 
         * Displays error messages in the chat interface while maintaining
         * conversation history and providing clear user feedback.
         */
        case 'chat:error':
          setState(prev => {
            const messages = [...prev.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
              // Replace streaming message with error
              messages[messages.length - 1] = {
                ...lastMessage,
                content: `Error: ${message.error}`,
                isStreaming: false
              };
            } else {
              // Add new error message
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
              isLoading: false,
              canApplyCode: false
            };
          });
          break;

        /**
         * Handle successful code application
         * 
         * Currently just logs success, but could be extended to show
         * user notifications or update UI to indicate successful application.
         */
        case 'editor:applied':
          // Could show a toast notification or update UI
          console.log('Code applied successfully');
          break;

        default:
          // Ignore unknown message types for forward compatibility
          break;
      }
    });

    // Cleanup listener when component unmounts
    return unsubscribe;
  }, [onMessage, generateMessageId, parseCodeBlocks]);

  // Return all chat state and functions for component consumption
  return {
    ...state,
    sendMessage,
    applyToSelection,
    replaceFile,
    createNewFile
  };
};

/**
 * USAGE PATTERNS IN COMPONENTS:
 * 
 * CHAT COMPONENT:
 * ```typescript
 * const { messages, isLoading, canApplyCode, sendMessage, ... } = useChat();
 * // Use messages for rendering, isLoading for UI state, etc.
 * ```
 * 
 * CHAT INPUT:
 * ```typescript
 * const { sendMessage, isLoading } = useChat();
 * // Call sendMessage when user submits input
 * // Use isLoading to disable input during processing
 * ```
 * 
 * ACTION BUTTONS:
 * ```typescript
 * const { canApplyCode, applyToSelection, replaceFile, createNewFile } = useChat();
 * // Show buttons only when canApplyCode is true
 * // Call appropriate function when buttons are clicked
 * ```
 * 
 * PERFORMANCE CONSIDERATIONS:
 * - All functions are memoized with useCallback to prevent unnecessary re-renders
 * - State updates are batched and immutable for efficient React reconciliation
 * - Message listener is set up once and reused for the component lifecycle
 * - Code parsing is optimized and only runs when AI responses complete
 * 
 * EXTENSIBILITY:
 * - Easy to add new message types by extending the switch statement
 * - Code application functions can be enhanced with additional options
 * - State can be extended with new features like conversation history or preferences
 * - Hook can be split into smaller hooks if it grows too large
 */