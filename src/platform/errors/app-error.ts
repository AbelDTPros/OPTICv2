export type ErrorDetails = Array<{
  field?: string;
  path?: string;
  message?: string;
  inputId?: string;
  [key: string]: unknown;
}>;

export class AppError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly httpStatus: number,
    public readonly details: ErrorDetails = [],
    public readonly summary?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFound(errorCode: string, message: string): AppError {
  return new AppError(errorCode, message, 404, [], message);
}

export function conflict(errorCode: string, message: string, details: ErrorDetails = []): AppError {
  return new AppError(errorCode, message, 409, details, message);
}

export function validationFailed(errorCode: string, message: string, details: ErrorDetails = []): AppError {
  return new AppError(errorCode, message, 400, details, message);
}

export function unauthorized(message = 'Authentication is required.'): AppError {
  return new AppError('OPTIC-AUTH-40101', message, 401, [], message);
}

export function forbidden(
  message = 'You are not authorized to perform this action.',
  errorCode = 'OPTIC-AUTHZ-40301'
): AppError {
  return new AppError(errorCode, message, 403, [], message);
}

export function createReferenceId(): string {
  return `OPTIC-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function fieldInputId(fieldKey: string): string {
  return `field-${fieldKey}`;
}
