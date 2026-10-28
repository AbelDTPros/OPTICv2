import type { FormFieldError } from '../dynamic-forms/DynamicFormRenderer.js';
import { ApiError, formatCaughtApiError } from './api-error.js';

/** Banner payload: structured API error (with field links) or flattened string. */
export type DisplayError = string | ApiError;

export function formErrorsFromApi(error: ApiError): FormFieldError[] {
  const mapped: FormFieldError[] = [];
  for (const detail of error.details) {
    const fromInput =
      detail.inputId?.startsWith('field-') && detail.inputId.length > 'field-'.length
        ? detail.inputId.slice('field-'.length)
        : undefined;
    const fieldKey = detail.field ?? fromInput;
    if (!fieldKey) {
      continue;
    }
    mapped.push({
      fieldKey,
      message: detail.message,
      inputId: detail.inputId ?? `field-${fieldKey}`
    });
  }
  return mapped;
}

function collectFieldValues(root: unknown, fieldKey: string, into: unknown[] = []): unknown[] {
  if (root == null || typeof root !== 'object') {
    return into;
  }
  if (Array.isArray(root)) {
    for (const item of root) {
      collectFieldValues(item, fieldKey, into);
    }
    return into;
  }
  const record = root as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, fieldKey)) {
    into.push(record[fieldKey]);
  }
  for (const value of Object.values(record)) {
    collectFieldValues(value, fieldKey, into);
  }
  return into;
}

function sameFieldValues(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => Object.is(value, right[index]));
}

/**
 * Keep validation messages for fields the officer has not edited yet.
 * Editing one required field must not hide the rest of the error list.
 */
export function retainFormErrorsAfterEdit(
  errors: FormFieldError[],
  previous: unknown,
  next: unknown
): FormFieldError[] {
  if (errors.length === 0 || previous === next) {
    return errors;
  }
  return errors.filter((error) =>
    sameFieldValues(collectFieldValues(previous, error.fieldKey), collectFieldValues(next, error.fieldKey))
  );
}

export function resolveCaughtError(
  error: unknown,
  fallback: string
): {
  apiError?: ApiError;
  formErrors: FormFieldError[];
  /** Top-level banner when there are no form field targets (or non-API failure). */
  banner?: DisplayError;
} {
  if (error instanceof ApiError) {
    const formErrors = formErrorsFromApi(error);
    return {
      apiError: error,
      formErrors,
      banner: formErrors.length > 0 ? undefined : error
    };
  }
  return {
    formErrors: [],
    banner: formatCaughtApiError(error, fallback)
  };
}

export function displayErrorKey(error: DisplayError): string {
  if (typeof error === 'string') {
    return error;
  }
  return `${error.errorCode ?? ''}:${error.message}:${error.details.map((detail) => detail.message).join('|')}`;
}

/** Coerce catch sites that still produce strings into DisplayError when possible. */
export function asDisplayError(error: unknown, fallback: string): DisplayError {
  if (error instanceof ApiError) {
    return error;
  }
  return formatCaughtApiError(error, fallback);
}
