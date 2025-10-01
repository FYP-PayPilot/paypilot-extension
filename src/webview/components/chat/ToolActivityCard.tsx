import React from 'react';

interface ToolActivityCardProps {
  title: string;
  detail?: string;
  filePath?: string;
  onCardClick?: (filePath: string) => void;
}

export const ToolActivityCard: React.FC<ToolActivityCardProps> = ({
  title,
  detail,
  filePath,
  onCardClick,
}) => {
  const handleClick = () => {
    if (filePath && onCardClick) {
      onCardClick(filePath);
    }
  };

  const isInteractive = Boolean(filePath && onCardClick);

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
        <span className="tool-activity-title">{title}</span>
      </div>
      {detail && <div className="tool-activity-detail">{detail}</div>}
    </div>
  );
};
