import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon.js';

export async function copyTrackingId(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) {
    return false;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

/** Icon-only control that copies the tracking id. */
export function TrackingIdCopyButton({ trackingId }: { trackingId: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="optic-tracking-copy-icon"
      title={copied ? 'Copied' : 'Copy tracking id'}
      aria-label={copied ? `Copied ${trackingId}` : `Copy tracking id ${trackingId}`}
      onClick={(event) => {
        event.stopPropagation();
        void copyTrackingId(trackingId).then((ok) => {
          if (ok) {
            setCopied(true);
          }
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  );
}

/** Tracking id opens on click when `onOpen` is set; copy icon always copies. */
export function TrackingIdLinkWithCopy({
  trackingId,
  onOpen
}: {
  trackingId: string;
  onOpen?: () => void;
}) {
  return (
    <span className="optic-tracking-actions">
      {onOpen ? (
        <button
          type="button"
          className="optic-tracking-link"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {trackingId}
        </button>
      ) : (
        <code className="optic-tracking-text">{trackingId}</code>
      )}
      <TrackingIdCopyButton trackingId={trackingId} />
    </span>
  );
}
