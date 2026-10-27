import { useEffect, useId, useRef } from 'react';
import { ButtonLabel } from '../ui/Icon.js';
import { MarkdownGuide } from './render-markdown.js';

export function UserGuideDialog({
  title,
  source,
  onClose
}: {
  title: string;
  source: string;
  onClose: () => void;
}) {
  const headingId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="optic-guide-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="optic-guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="optic-guide-dialog-header">
          <h2 id={headingId}>{title}</h2>
          <button ref={closeRef} type="button" aria-label="Close user guide" onClick={onClose}>
            <ButtonLabel icon="clear">Close</ButtonLabel>
          </button>
        </header>
        <div className="optic-guide-dialog-scroll">
          <MarkdownGuide source={source} />
        </div>
      </div>
    </div>
  );
}
