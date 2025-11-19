import React, { useState } from 'react';
import { ChatMessage as ChatMessageType } from '../../../features/chat/messages';
import { CodeAppliedCard } from './CodeAppliedCard';
import { ToolActivityCard } from './ToolActivityCard';
import { MultiFileEditSummary } from './MultiFileEditSummary';
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
   * Render lightweight markdown (bold, italic, inline code, headings, line breaks)
   */
  const renderMarkdown = (text: string) => {
    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const codePlaceholders: string[] = [];
    let html = escapeHtml(text);

    html = html.replace(/`([^`]+)`/g, (_, code) => {
      const idx = codePlaceholders.push(code) - 1;
      return `__CODE_PLACEHOLDER_${idx}__`;
    });

    const headingLevels: Array<{ regex: RegExp; level: number }> = [
      { regex: /^######\s?(.*)$/gm, level: 6 },
      { regex: /^#####\s?(.*)$/gm, level: 5 },
      { regex: /^####\s?(.*)$/gm, level: 4 },
      { regex: /^###\s?(.*)$/gm, level: 3 },
      { regex: /^##\s?(.*)$/gm, level: 2 },
      { regex: /^#\s?(.*)$/gm, level: 1 },
    ];

    headingLevels.forEach(({ regex, level }) => {
      html = html.replace(regex, (_match, content) => {
        const cls = `heading heading-${level}`;
        return `<h${level} class="${cls}">${content.trim()}</h${level}>`;
      });
    });

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*]+)\*/g, (_match, prefix, content) => {
      return `${prefix}<em>${content}</em>`;
    });

    html = html.replace(/(?:\r\n|\r|\n)/g, '<br />');
    html = html.replace(/(<\/h[1-6]>)<br \/>/g, '$1');

    codePlaceholders.forEach((code, index) => {
      html = html.replace(
        `__CODE_PLACEHOLDER_${index}__`,
        `<code class="inline-code">${code}</code>`
      );
    });

    return <span dangerouslySetInnerHTML={{ __html: html }} />;
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

  // Handle thinking/working state
  if (message.isThinking || message.isWorking) {
    return (
      <div className="message message-assistant message-card">
        <div
          className="thinking-indicator"
          role="status"
          aria-label="Assistant is working"
        >
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          <span className="thinking-dot" />
        </div>
      </div>
    );
  }

  const assistantCardClass = "message message-assistant message-card";

  // Handle code applied state
  if (message.codeApplied) {
    return (
      <div className={assistantCardClass}>
        <CodeAppliedCard
          fileName={message.codeApplied.fileName}
          filePath={message.codeApplied.filePath}
          linesAdded={message.codeApplied.linesAdded}
          linesDeleted={message.codeApplied.linesDeleted}
          explanation={message.codeApplied.explanation}
          operation={message.codeApplied.operation}
          onCardClick={handleFileClick}
        />
      </div>
    );
  }

  if (message.agentPlan) {
    return (
      <div className={assistantCardClass}>
        <div className="agent-plan-card">
          <div className="agent-plan-title">{message.agentPlan.title}</div>
          <ol className="agent-plan-list">
            {message.agentPlan.steps.map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  if (message.toolActivity) {
    return (
      <div className={assistantCardClass}>
        <ToolActivityCard
          title={message.toolActivity.title}
          detail={message.toolActivity.detail}
          filePath={message.toolActivity.filePath}
          operation={message.toolActivity.operation}
          onCardClick={handleFileClick}
        />
      </div>
    );
  }

  if (message.multiFileEditSummary) {
    return (
      <div className={assistantCardClass}>
        <MultiFileEditSummary
          changes={message.multiFileEditSummary.changes}
          totalLinesAdded={message.multiFileEditSummary.totalLinesAdded}
          totalLinesDeleted={message.multiFileEditSummary.totalLinesDeleted}
          onFileClick={handleFileClick}
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
              {renderMarkdown(part.content)}
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
