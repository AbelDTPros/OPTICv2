import { useEffect } from 'react';

/** Brief, polite success notice — does not steal focus. */
export function StatusToast({
  message,
  onDismiss,
  durationMs = 2800
}: {
  message?: string;
  onDismiss: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss, durationMs]);

  if (!message) {
    return null;
  }

  return (
    <div className="optic-status-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
