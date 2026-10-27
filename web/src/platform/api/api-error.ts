export interface ApiErrorDetail {
  field?: string;
  path?: string;
  message: string;
  inputId?: string;
}

export interface ApiErrorInit {
  summary: string;
  message?: string;
  status?: number;
  errorCode?: string;
  referenceId?: string;
  correlationId?: string;
  details?: Array<string | ApiErrorDetail>;
}

export class ApiError extends Error {
  readonly status?: number;
  readonly errorCode?: string;
  readonly summary: string;
  readonly referenceId?: string;
  readonly correlationId?: string;
  readonly details: ApiErrorDetail[];

  constructor(init: ApiErrorInit) {
    super(init.message ?? init.summary);
    this.name = 'ApiError';
    this.summary = init.summary;
    this.status = init.status;
    this.errorCode = init.errorCode;
    this.referenceId = init.referenceId;
    this.correlationId = init.correlationId;
    this.details = (init.details ?? []).map((detail) =>
      typeof detail === 'string' ? { message: detail } : { ...detail, message: detail.message }
    );
  }

  get detailMessages(): string[] {
    return this.details.map((detail) => detail.message).filter(Boolean);
  }
}

export class DesignerApiError extends ApiError {
  constructor(
    message: string,
    status?: number,
    errorCode?: string,
    details: Array<string | ApiErrorDetail> = [],
    envelope?: Pick<ApiErrorInit, 'referenceId' | 'correlationId'>
  ) {
    super({ summary: message, status, errorCode, details, ...envelope });
    this.name = 'DesignerApiError';
  }
}

export class SearchApiError extends ApiError {
  constructor(message: string, status?: number, envelope?: Pick<ApiErrorInit, 'errorCode' | 'referenceId' | 'correlationId' | 'details'>) {
    super({ summary: message, status, ...envelope });
    this.name = 'SearchApiError';
  }
}

export class OpticApiError extends ApiError {
  constructor(message: string, status?: number, envelope?: Pick<ApiErrorInit, 'errorCode' | 'referenceId' | 'correlationId' | 'details'>) {
    super({ summary: message, status, ...envelope });
    this.name = 'OpticApiError';
  }
}

export function isOpticErrorPayload(
  payload: unknown
): payload is {
  error: {
    errorCode: string;
    summary?: string;
    message?: string;
    referenceId?: string;
    details?: Array<{ field?: string; path?: string; message?: string; inputId?: string }>;
  };
  meta?: { correlationId?: string };
} {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    return false;
  }
  const error = (payload as { error?: { errorCode?: unknown } }).error;
  return Boolean(error && typeof error.errorCode === 'string' && error.errorCode.startsWith('OPTIC-'));
}

export function apiErrorFromPayload(
  status: number,
  payload: unknown,
  fallback: string
): ApiError {
  if (!isOpticErrorPayload(payload)) {
    return new ApiError({ summary: fallback, status });
  }
  const details = (payload.error.details ?? [])
    .filter((detail) => Boolean(detail?.message))
    .map((detail) => ({
      field: detail.field,
      path: detail.path,
      message: detail.message!,
      inputId: detail.inputId
    }));
  return new ApiError({
    summary: payload.error.summary ?? payload.error.message ?? fallback,
    message: payload.error.message ?? payload.error.summary ?? fallback,
    status,
    errorCode: payload.error.errorCode,
    referenceId: payload.error.referenceId,
    correlationId: payload.meta?.correlationId,
    details
  });
}

export function formatApiError(error: ApiError): string {
  return [
    error.summary,
    ...error.detailMessages,
    error.referenceId ? `Give this id to support: ${error.referenceId}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatCaughtApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return formatApiError(error);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
