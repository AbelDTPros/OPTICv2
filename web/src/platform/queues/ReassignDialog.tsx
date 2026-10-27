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
  const headingId = `reassign-${trackingId}-heading`;

  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <div className="optic-reassign-backdrop" onClick={onCancel}>
      <div
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
            <button type="button" onClick={onCancel}>
              <ButtonLabel icon="clear">Cancel</ButtonLabel>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
