import React from 'react';
import { Button } from '../ui/Button';

interface ActionButtonsProps {
  canApplyCode: boolean;
  onApplyToSelection: () => void;
  onReplaceFile: () => void;
  onCreateNewFile: () => void;
}

/**
 * Action buttons for applying generated code
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({
  canApplyCode,
  onApplyToSelection,
  onReplaceFile,
  onCreateNewFile
}) => {
  if (!canApplyCode) {
    return null;
  }

  return (
    <div className="action-buttons">
      <Button
        variant="ghost"
        size="sm"
        onClick={onApplyToSelection}
        title="Apply code to current selection"
      >
        <CheckIcon />
        Apply to selection
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onReplaceFile}
        title="Replace entire file with generated code"
      >
        <FileIcon />
        Replace file
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCreateNewFile}
        title="Create new file with generated code"
      >
        <PlusIcon />
        Create new file
      </Button>
    </div>
  );
};

// Icon components
const CheckIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
  </svg>
);

const FileIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
    <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
  </svg>
);

const PlusIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8.5 1.5A1.5 1.5 0 0 0 7 0H4.5A1.5 1.5 0 0 0 3 1.5v13A1.5 1.5 0 0 0 4.5 16h7a1.5 1.5 0 0 0 1.5-1.5V4.707a1 1 0 0 0-.293-.707L9.293 0.586A1 1 0 0 0 8.5 0.293V1.5z"/>
    <path d="M8 5.5a.5.5 0 0 1 .5.5v1.5H10a.5.5 0 0 1 0 1H8.5V10a.5.5 0 0 1-1 0V8.5H6a.5.5 0 0 1 0-1h1.5V6a.5.5 0 0 1 .5-.5z"/>
  </svg>
);
