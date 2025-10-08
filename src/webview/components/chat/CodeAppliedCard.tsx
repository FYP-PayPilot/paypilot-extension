import React from 'react';

interface CodeAppliedCardProps {
  fileName: string;
  filePath: string;
  linesAdded: number;
  linesDeleted: number;
  explanation: string;
  operation: 'create' | 'update' | 'delete';
  onCardClick?: (filePath: string) => void;
}

export const CodeAppliedCard: React.FC<CodeAppliedCardProps> = ({
  fileName,
  filePath,
  linesAdded,
  linesDeleted,
  explanation,
  operation,
  onCardClick
}) => {
  const handleClick = () => {
    if (onCardClick) {
      onCardClick(filePath);
    }
  };

  const operationLabel =
    operation === "create" ? "Created" : operation === "delete" ? "Deleted" : "Updated";

  return (
    <div className="code-applied-card" onClick={handleClick} title={`Click to open ${fileName}`}>
      <div className="code-applied-header">
        <div className="file-info">
          <svg className="file-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2a1 1 0 011-1h5.5L12 4.5V14a1 1 0 01-1 1H3a1 1 0 01-1-1V2zm8.5 2.5L8 2v2.5h2.5z"/>
          </svg>
          <span className="file-name">{fileName}</span>
          <span className="file-operation">{operationLabel}</span>
        </div>
        <div className="diff-stats">
          {linesAdded > 0 && (
            <span className="lines-added">
              <svg className="diff-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a.5.5 0 01.5.5v5h5a.5.5 0 010 1h-5v5a.5.5 0 01-1 0v-5h-5a.5.5 0 010-1h5v-5A.5.5 0 018 2z"/>
              </svg>
              {linesAdded}
            </span>
          )}
          {linesDeleted > 0 && (
            <span className="lines-deleted">
              <svg className="diff-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 7.5a.5.5 0 01.5-.5h10a.5.5 0 010 1H3a.5.5 0 01-.5-.5z"/>
              </svg>
              {linesDeleted}
            </span>
          )}
          {linesAdded === 0 && linesDeleted === 0 && (
            <span className="lines-unchanged">
              No changes
            </span>
          )}
        </div>
      </div>
      {explanation && (
        <div className="code-applied-explanation">
          {explanation}
        </div>
      )}
    </div>
  );
};
