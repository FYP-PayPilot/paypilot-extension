import React, { useState } from 'react';
import { ChatMessage as ChatMessageType } from '../../../types/chat';
import { CodeAppliedCard } from './CodeAppliedCard';
import { useVSCode } from '../../context/VSCodeContext';

interface ChatMessageProps {
  message: ChatMessageType;
}

/**
 * Component for rendering individual chat messages with CSS classes
 * Handles code block rendering and copy functionality
 */
export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const { postMessage } = useVSCode();

  const handleFileClick = (filePath: string) => {
    postMessage({
      type: 'file:open',
      filePath
    });
  };

  /**
   * Format text content with markdown support
   */
  const formatTextContent = (text: string) => {
    // Handle markdown formatting in order of priority
    const parts: React.ReactNode[] = [];
    const lines = text.split('\n');
    
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        parts.push(<br key={`br-${lineIndex}`} />);
      }
      
      // Process the line for markdown
      let processedLine = line;
      const tokens: Array<{ type: string; content: string; start: number; end: number }> = [];
      
      // Find bold text (**text**)
      const boldRegex = /\*\*(.*?)\*\*/g;
      let boldMatch: RegExpExecArray | null;
      while ((boldMatch = boldRegex.exec(line)) !== null) {
        tokens.push({
          type: 'bold',
          content: boldMatch[1],
          start: boldMatch.index,
          end: boldMatch.index + boldMatch[0].length
        });
      }
      
      // Find headings (## text)
      const headingRegex = /^(#{1,6})\s+(.+)$/;
      const headingMatch = headingRegex.exec(line.trim());
      if (headingMatch) {
        const level = headingMatch[1].length;
        tokens.push({
          type: `heading${level}` as any,
          content: headingMatch[2],
          start: 0,
          end: line.length
        });
      }
      
      // Find italic text (*text*)
      const italicRegex = /\*([^*]+?)\*/g;
      let italicMatch: RegExpExecArray | null;
      while ((italicMatch = italicRegex.exec(line)) !== null) {
        // Make sure it's not part of a bold (avoid conflict with **)
        const isPartOfBold = tokens.some(token => 
          token.type === 'bold' && italicMatch!.index >= token.start - 2 && italicMatch!.index <= token.end + 2
        );
        if (!isPartOfBold) {
          tokens.push({
            type: 'italic',
            content: italicMatch[1],
            start: italicMatch.index,
            end: italicMatch.index + italicMatch[0].length
          });
        }
      }
      
      // Find inline code (`code`)
      const inlineCodeRegex = /`([^`]+?)`/g;
      let codeMatch: RegExpExecArray | null;
      while ((codeMatch = inlineCodeRegex.exec(line)) !== null) {
        tokens.push({
          type: 'code',
          content: codeMatch[1],
          start: codeMatch.index,
          end: codeMatch.index + codeMatch[0].length
        });
      }
      
      // Sort tokens by start position
      tokens.sort((a, b) => a.start - b.start);
      
      // Build the formatted line
      let lastIndex = 0;
      const formattedParts: React.ReactNode[] = [];
      
      tokens.forEach((token, tokenIndex) => {
        // Add text before this token
        if (token.start > lastIndex) {
          formattedParts.push(line.slice(lastIndex, token.start));
        }
        
        // Add the formatted token
        const key = `${lineIndex}-${tokenIndex}`;
        switch (token.type) {
          case 'bold':
            formattedParts.push(<strong key={key}>{token.content}</strong>);
            break;
          case 'italic':
            formattedParts.push(<em key={key}>{token.content}</em>);
            break;
          case 'code':
            formattedParts.push(<code key={key} className="inline-code">{token.content}</code>);
            break;
          case 'heading1':
            formattedParts.push(<h1 key={key} className="heading heading-1">{token.content}</h1>);
            break;
          case 'heading2':
            formattedParts.push(<h2 key={key} className="heading heading-2">{token.content}</h2>);
            break;
          case 'heading3':
            formattedParts.push(<h3 key={key} className="heading heading-3">{token.content}</h3>);
            break;
          case 'heading4':
            formattedParts.push(<h4 key={key} className="heading heading-4">{token.content}</h4>);
            break;
          case 'heading5':
            formattedParts.push(<h5 key={key} className="heading heading-5">{token.content}</h5>);
            break;
          case 'heading6':
            formattedParts.push(<h6 key={key} className="heading heading-6">{token.content}</h6>);
            break;
        }
        
        lastIndex = token.end;
      });
      
      // Add remaining text
      if (lastIndex < line.length) {
        formattedParts.push(line.slice(lastIndex));
      }
      
      // If no formatting was found, just add the plain text
      if (formattedParts.length === 0) {
        formattedParts.push(line);
      }
      
      parts.push(...formattedParts);
    });
    
    return parts;
  };

  /**
   * Format message content with code blocks
   */
  const formatMessageContent = (content: string) => {
    const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/g;
    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: content.slice(lastIndex, match.index)
        });
      }

      // Add code block
      parts.push({
        type: 'code',
        content: match[2]?.trim() || '',
        language: match[1] || 'text'
      });

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push({
        type: 'text',
        content: content.slice(lastIndex)
      });
    }

    return parts;
  };

  /**
   * Copy code to clipboard
   */
  const copyCode = async (code: string, id: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeId(id);
      setTimeout(() => setCopiedCodeId(null), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const parts = formatMessageContent(message.content);
  const isUser = message.role === 'user';

  // Handle working state
  if (message.isWorking) {
    return (
      <div className="message message-assistant">
        <div className="working-indicator">
          <div className="loading-spinner"></div>
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  // Handle code applied state
  if (message.codeApplied) {
    return (
      <div className="message message-assistant">
        <CodeAppliedCard
          fileName={message.codeApplied.fileName}
          filePath={message.codeApplied.filePath}
          linesAdded={message.codeApplied.linesAdded}
          linesDeleted={message.codeApplied.linesDeleted}
          explanation={message.codeApplied.explanation}
          onCardClick={handleFileClick}
        />
      </div>
    );
  }

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return (
            <div key={index} className="message-text">
              {formatTextContent(part.content)}
            </div>
          );
        } else {
          const codeId = `code_${message.id}_${index}`;
          const isCopied = copiedCodeId === codeId;

          return (
            <div key={index} className="code-block-container">
              <div className="code-header">
                <span className="code-language">{part.language}</span>
                <button
                  className={`copy-btn ${isCopied ? 'copied' : ''}`}
                  onClick={() => copyCode(part.content, codeId)}
                  title={isCopied ? 'Copied!' : 'Copy code'}
                >
                  {isCopied ? (
                    <>
                      <CheckIcon />
                      Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="code-content">
                <code className={`language-${part.language}`}>
                  {part.content}
                </code>
              </pre>
            </div>
          );
        }
      })}
      {message.isStreaming && (
        <span className="streaming-indicator">●</span>
      )}
    </div>
  );
};

// Icon components
const CopyIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
    <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
  </svg>
);
