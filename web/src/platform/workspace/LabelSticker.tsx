import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { CaseLabel } from './labels.js';

export function LabelSticker({ label }: { label: CaseLabel }) {
  const [qr, setQr] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(label.payload, { type: 'svg', margin: 0, width: 128, errorCorrectionLevel: 'M' })
      .then((svg) => {
        if (!cancelled) {
          setQr(svg);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQr('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [label.payload]);

  return (
    <article className="optic-sticker" aria-label={`${label.entityType} label ${label.trackingId}`}>
      <div className="optic-sticker-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr }} />
      <div>
        <p className="optic-sticker-kind">
          {label.kindLabel} · {label.entityType}
        </p>
        <p className="optic-sticker-tracking">{label.trackingId}</p>
        {label.statusCaption ? (
          <p>
            {label.statusCaption}: {label.statusText || '—'}
          </p>
        ) : null}
        <p>Stage: {label.stageLabel}</p>
      </div>
    </article>
  );
}

export async function qrSvgForPayload(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: 'svg', margin: 0, width: 128, errorCorrectionLevel: 'M' });
}
