import React from 'react';
import { ContextFile } from '../../../types/chat';
import { Button } from '../ui/Button';
import { HiXMark, HiDocument } from 'react-icons/hi2';

interface ContextListProps {
  contextFiles: ContextFile[];
  onRemoveFile: (filePath: string) => void;
  onClearAll: () => void;
}

/**
 * Displays the current context files with options to remove them
 */
export const ContextList: React.FC<ContextListProps> = ({ 
  contextFiles, 
  onRemoveFile, 
  onClearAll 
}) => {
  if (contextFiles.length === 0) {
    return null;
  }

  return (
    <div className="context-list">
      <div className="context-header">
        <span className="context-title">
          <HiDocument size={14} />
          Context Files ({contextFiles.length})
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          title="Clear all context files"
          className="clear-all-button"
        >
          Clear All
        </Button>
      </div>
      <div className="context-files">
        {contextFiles.map((file) => (
          <div key={file.filePath} className="context-file">
            <div className="context-file-info">
              <span className="context-file-name" title={file.filePath}>
                {file.fileName}
              </span>
              {file.size && (
                <span className="context-file-size">
                  {formatFileSize(file.size)}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemoveFile(file.filePath)}
              title={`Remove ${file.fileName} from context`}
              className="remove-file-button"
            >
              <HiXMark size={14} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
