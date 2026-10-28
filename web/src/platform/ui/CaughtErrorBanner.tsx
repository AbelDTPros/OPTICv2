import type { DisplayError } from '../api/apply-api-error.js';
import { ApiError } from '../api/api-error.js';
import { displayErrorKey } from '../api/apply-api-error.js';
import { DesignerErrorBody, ErrorSummary } from './ErrorSummary.js';

/** Shared error banner: prefers structured ApiError (field links) over flattened text. */
export function CaughtErrorBanner({
  error,
  focus = true
}: {
  error?: DisplayError;
  focus?: boolean;
}) {
  if (!error) {
    return null;
  }
  if (error instanceof ApiError) {
    return <ErrorSummary key={displayErrorKey(error)} focus={focus} error={error} />;
  }
  return (
    <ErrorSummary key={error} focus={focus}>
      <DesignerErrorBody message={error} />
    </ErrorSummary>
  );
}
