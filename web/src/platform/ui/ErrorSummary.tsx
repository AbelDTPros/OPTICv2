import { useEffect, useRef, type ReactNode } from 'react';
import { ErrorFieldLink } from '../accessibility/ErrorFieldLink.js';
import { focusElement } from '../accessibility/focus-field.js';
import { ApiError } from '../api/api-error.js';
import { ErrorHeading } from './Icon.js';

export function ErrorSummary({
  children,
  heading,
  role = 'alert',
  focus = false,
  error
}: {
  children?: ReactNode;
  heading?: ReactNode;
  role?: 'alert' | 'status';
  focus?: boolean;
  error?: ApiError;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) {
      return;
    }
    ref.current?.focus({ preventScroll: true });
    const firstLink = ref.current?.querySelector<HTMLAnchorElement>('a[href^="#"]');
    const targetId = firstLink?.getAttribute('href')?.slice(1);
    if (targetId) {
      window.setTimeout(() => {
        focusElement(document.getElementById(targetId));
      }, 120);
    }
  }, [focus, children, error]);

  return (
    <div className="optic-error-summary" role={role} tabIndex={-1} ref={ref} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
      <ErrorHeading>{heading}</ErrorHeading>
      {error ? <ApiErrorBody error={error} /> : children}
    </div>
  );
}

export function ApiErrorBody({ error }: { error: ApiError }) {
  return (
    <>
      <p>{error.summary}</p>
      {error.details.length > 0 ? (
        <ul>
          {error.details.map((detail, index) => (
            <li key={`${detail.inputId ?? detail.path ?? detail.field ?? index}-${detail.message}`}>
              {detail.inputId ? (
                <ErrorFieldLink inputId={detail.inputId}>{detail.message}</ErrorFieldLink>
              ) : (
                detail.message
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {error.referenceId ? <p className="optic-help">Give this id to support: {error.referenceId}</p> : null}
    </>
  );
}

/** Splits a joined API error (summary + detail lines) into a paragraph and list. */
export function DesignerErrorBody({ message }: { message: string }) {
  const lines = message.split('\n').filter(Boolean);
  const support = lines.find((line) => line.startsWith('Give this id to support:'));
  const rest = lines.filter((line) => line !== support);
  if (rest.length <= 1) {
    return (
      <>
        <p>{rest[0] ?? message}</p>
        {support ? <p className="optic-help">{support}</p> : null}
      </>
    );
  }
  return (
    <>
      <p>{rest[0]}</p>
      <ul>
        {rest.slice(1).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {support ? <p className="optic-help">{support}</p> : null}
    </>
  );
}
