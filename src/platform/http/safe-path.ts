import type { Request } from 'express';

export function safePath(req: Request): string {
  const raw = req.originalUrl || req.path;
  return raw.split('?')[0] ?? req.path;
}
