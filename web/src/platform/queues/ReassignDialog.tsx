import { useEffect, useRef, useState } from 'react';
import { ButtonLabel } from '../ui/Icon.js';

export function ReassignDialog({
  trackingId,
  onCancel,
  onConfirm
}: {
  trackingId: string;
  onCancel: () => void;
  onConfirm: (assignedTo: string) => void;
}) {
  const [assignedTo, setAssignedTo] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const headingId = `reassign-${trackingId}-heading`;

  useEffect(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const node = dialog.current;
    if (!node) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !node) {
        return;
      }
      const focusable = node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="optic-reassign-backdrop" onClick={onCancel}>
      <div
        ref={dialog}
        className="optic-reassign-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={headingId}>Reassign {trackingId}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = assignedTo.trim();
            if (next) {
              onConfirm(next);
            }
          }}
        >
          <label>
            Reassign to
            <input
              ref={input}
              type="text"
              value={assignedTo}
              autoComplete="off"
              spellCheck={false}
              placeholder="Name or email"
              onChange={(event) => setAssignedTo(event.target.value)}
            />
          </label>
          <div className="optic-button-row">
            <button type="submit" className="optic-button-primary" disabled={!assignedTo.trim()}>
              <ButtonLabel icon="user">Reassign</ButtonLabel>
            </button>
            <button type="button" className="optic-button-secondary" onClick={onCancel}>
              <ButtonLabel icon="clear">Cancel</ButtonLabel>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
