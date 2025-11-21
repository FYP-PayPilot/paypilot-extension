import React, { forwardRef, useEffect, useRef, useState } from 'react';

interface TextareaProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  autoResize?: boolean;
  maxHeight?: number;
  className?: string;
}

/**
 * Clean auto-resizing textarea component using CSS classes only
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({
  value,
  onChange,
  onKeyDown,
  placeholder,
  disabled = false,
  autoResize = true,
  maxHeight = 140,
  className = ''
}, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const combinedRef = (ref as React.MutableRefObject<HTMLTextAreaElement>) || textareaRef;

  /**
   * Auto-resize the textarea based on content
   */
  const autoGrow = () => {
    const textarea = combinedRef.current;
    if (!textarea || !autoResize) return;

    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  };

  useEffect(() => {
    autoGrow();
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    autoGrow();
  };

  const classes = [
    'textarea',
    disabled ? 'textarea-disabled' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <textarea
      ref={combinedRef}
      value={value}
      onChange={handleChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      className={classes}
      rows={1}
      style={{ maxHeight: `${maxHeight}px` }}
    />
  );
});

Textarea.displayName = 'Textarea';
