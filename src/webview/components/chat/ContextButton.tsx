import React from 'react';
import { Button } from '../ui/Button';
import { HiDocumentPlus } from 'react-icons/hi2';

interface ContextButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Add Context button component - triggers file picker to add files to chat context
 */
export const ContextButton: React.FC<ContextButtonProps> = ({ 
  onClick, 
  disabled = false 
}) => {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title="Add files to context"
      className="context-button"
    >
      <HiDocumentPlus size={16} />
      Add Context...
    </Button>
  );
};
