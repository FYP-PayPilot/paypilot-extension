import React from 'react';

interface FileChange {
  fileName: string;
  filePath: string;
  operation: 'create' | 'update' | 'delete' | 'directory' | 'directory-delete' | 'read';
  linesAdded?: number;
  linesDeleted?: number;
}

interface MultiFileEditSummaryProps {
  changes: FileChange[];
  totalLinesAdded: number;
  totalLinesDeleted: number;
  onFileClick?: (filePath: string) => void;
}

export const MultiFileEditSummary: React.FC<MultiFileEditSummaryProps> = ({
  changes,
  totalLinesAdded,
  totalLinesDeleted,
  onFileClick,
}) => {
  const fileOperations = changes.reduce((acc, change) => {
    acc[change.operation] = (acc[change.operation] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const getOperationIcon = (operation: string) => {
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
      default:
        return '🔧';
    }
  };

  const getOperationColor = (operation: string) => {
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
      default:
        return 'var(--vscode-foreground)';
    }
  };

  const handleFileClick = (filePath: string) => {
    if (onFileClick) {
      onFileClick(filePath);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent, filePath: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleFileClick(filePath);
    }
  };

  return (
    <div className="multi-file-edit-summary">
      <div className="summary-header">
        <h3 className="summary-title">📊 Edit Summary</h3>
        <div className="summary-stats">
          <span className="file-count">{changes.length} files affected</span>
          {totalLinesAdded > 0 && (
            <span className="lines-added">+{totalLinesAdded} lines</span>
          )}
          {totalLinesDeleted > 0 && (
            <span className="lines-deleted">-{totalLinesDeleted} lines</span>
          )}
        </div>
      </div>

      <div className="operation-summary">
        {Object.entries(fileOperations).map(([operation, count]) => (
          <div key={operation} className="operation-stat">
            <span className="operation-icon">{getOperationIcon(operation)}</span>
            <span className="operation-text">
              {count} {operation}{count > 1 ? 's' : ''}
            </span>
          </div>
        ))}
      </div>

      <div className="file-changes">
        <h4 className="changes-title">Files Changed:</h4>
        {changes.map((change, index) => (
          <div
            key={index}
            className={`file-change ${onFileClick ? 'file-change--interactive' : ''}`}
            onClick={() => handleFileClick(change.filePath)}
            onKeyDown={(e) => handleKeyDown(e, change.filePath)}
            role={onFileClick ? 'button' : undefined}
            tabIndex={onFileClick ? 0 : undefined}
          >
            <div className="file-change-header">
              <span
                className="operation-badge"
                style={{ color: getOperationColor(change.operation) }}
              >
                {getOperationIcon(change.operation)} {change.operation}
              </span>
              <span className="file-name">{change.fileName}</span>
            </div>
            {(change.linesAdded !== undefined || change.linesDeleted !== undefined) && (
              <div className="line-changes">
                {change.linesAdded !== undefined && change.linesAdded > 0 && (
                  <span className="lines-added">+{change.linesAdded}</span>
                )}
                {change.linesDeleted !== undefined && change.linesDeleted > 0 && (
                  <span className="lines-deleted">-{change.linesDeleted}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
