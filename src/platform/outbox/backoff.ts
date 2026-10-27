export function nextRetryAt(
  attemptCount: number,
  backoff: 'EXPONENTIAL' | 'FIXED',
  baseMs: number,
  from = new Date()
): Date {
  const exponent = backoff === 'EXPONENTIAL' ? Math.max(0, attemptCount - 1) : 0;
  const delay = Math.min(baseMs * 2 ** exponent, 3_600_000);
  return new Date(from.getTime() + delay);
}

export function truncateError(message: string, max = 1000): string {
  return message.length <= max ? message : message.slice(0, max);
}
