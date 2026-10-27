import { validationFailed } from '../platform/errors/app-error.js';

export const MISSING = Symbol('JSON_PATH_MISSING');

export type ResolvedValue = unknown | typeof MISSING;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_SEGMENTS = 32;

export interface ResolveContext {
  businessData: unknown;
  workflow?: Record<string, unknown>;
}

export function resolveJsonPath(path: string, context: ResolveContext): ResolvedValue {
  if (typeof path !== 'string' || path.length === 0) {
    throw pathError('JSONPath is required.');
  }
  if (path.includes('..') || path.includes('(') || path.includes('@') || path.includes('*')) {
    throw pathError('JSONPath filters, scripts, wildcards, and recursive descent are not allowed.');
  }

  let root: unknown;
  let remainder: string;
  if (path === '$' || path.startsWith('$.')) {
    root = context.businessData;
    remainder = path === '$' ? '' : path.slice(2);
  } else if (path === '$workflow' || path.startsWith('$workflow.')) {
    root = context.workflow ?? {};
    remainder = path === '$workflow' ? '' : path.slice('$workflow.'.length);
  } else {
    throw pathError('JSONPath must start with $ or $workflow.');
  }

  if (remainder === '') {
    return root === undefined ? MISSING : root;
  }

  const segments = parseSegments(remainder);
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return MISSING;
    }
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return MISSING;
      }
      current = current[segment];
      continue;
    }
    if (typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
      return MISSING;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current === undefined ? MISSING : current;
}

function parseSegments(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  let remaining = path;
  while (remaining.length > 0) {
    if (segments.length >= MAX_SEGMENTS) {
      throw pathError('JSONPath exceeds the maximum segment depth.');
    }
    if (remaining.startsWith('[')) {
      const end = remaining.indexOf(']');
      if (end < 0) {
        throw pathError('JSONPath has an unclosed indexer.');
      }
      const inner = remaining.slice(1, end);
      if (/^\d+$/.test(inner)) {
        segments.push(Number(inner));
      } else if (
        (inner.startsWith("'") && inner.endsWith("'")) ||
        (inner.startsWith('"') && inner.endsWith('"'))
      ) {
        segments.push(inner.slice(1, -1));
      } else {
        throw pathError('JSONPath indexer must be a number or quoted identifier.');
      }
      remaining = remaining.slice(end + 1).replace(/^\./, '');
      continue;
    }
    const next = remaining.search(/\.|\[/);
    const ident = next === -1 ? remaining : remaining.slice(0, next);
    if (!IDENT.test(ident)) {
      throw pathError(`JSONPath segment "${ident}" is not a safe identifier.`);
    }
    segments.push(ident);
    remaining = next === -1 ? '' : remaining.slice(next).replace(/^\./, '');
  }
  return segments;
}

export function isMissing(value: ResolvedValue): value is typeof MISSING {
  return value === MISSING;
}

function pathError(message: string): never {
  throw validationFailed('OPTIC-WF-40030', message, [{ field: 'path', path: 'path', message }]);
}
