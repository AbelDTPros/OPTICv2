import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestLogContext {
  correlationId?: string;
  sessionId?: string;
  actorId?: string;
  operation?: string;
  entityType?: string;
  trackingId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestLogContext>();

export function runWithRequestContext<T>(context: RequestLogContext, fn: () => T): T {
  return requestContext.run(context, fn);
}

export function updateRequestContext(patch: Partial<RequestLogContext>): void {
  const current = requestContext.getStore();
  if (current) {
    Object.assign(current, patch);
  }
}

export function getRequestContext(): RequestLogContext {
  return requestContext.getStore() ?? {};
}
