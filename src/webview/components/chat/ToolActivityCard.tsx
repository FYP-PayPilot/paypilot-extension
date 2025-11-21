import React from 'react';

interface ToolActivityCardProps {
  title: string;
  detail?: string;
  filePath?: string;
  operation?: string;
  onCardClick?: (filePath: string) => void;
}

export const ToolActivityCard: React.FC<ToolActivityCardProps> = ({
  title,
  detail: _detail,
  filePath,
  operation,
  onCardClick,
}) => {
  const handleClick = () => {
    if (filePath && onCardClick) {
      onCardClick(filePath);
    }
  };

  const isInteractive = Boolean(filePath && onCardClick);

  const getOperationIcon = (operation?: string) => {
    switch (operation) {
      case 'create':
        return '➕';
      case 'update':
        return '✏️';
      case 'delete':
        return '🗑️';
      case 'directory':
        return '📁';
      case 'directory-delete':
        return '📁🗑️';
      case 'read':
        return '👁️';
      case 'context':
        return '📋';
      default:
        return '🔧';
    }
  };

  const getOperationColor = (operation?: string) => {
    switch (operation) {
      case 'create':
        return 'var(--vscode-gitDecoration-addedResourceForeground)';
      case 'update':
        return 'var(--vscode-gitDecoration-modifiedResourceForeground)';
      case 'delete':
        return 'var(--vscode-gitDecoration-deletedResourceForeground)';
      case 'directory':
        return 'var(--vscode-charts-blue)';
      case 'directory-delete':
        return 'var(--vscode-charts-red)';
      case 'read':
        return 'var(--vscode-charts-gray)';
      case 'context':
        return 'var(--vscode-charts-purple)';
      default:
        return 'var(--vscode-foreground)';
    }
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!isInteractive) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      className={`tool-activity-card${isInteractive ? ' tool-activity-card--interactive' : ''}`}
      onClick={handleClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="tool-activity-header">
        {operation && (
          <span 
            className="tool-activity-icon"
            style={{ color: getOperationColor(operation) }}
          >
            {getOperationIcon(operation)}
          </span>
        )}
        <span className="tool-activity-title">{title}</span>
        {operation && (
          <span 
            className="tool-activity-operation"
            style={{ color: getOperationColor(operation) }}
          >
            {operation}
          </span>
        )}
      </div>
    </div>
  );
};
