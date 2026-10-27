import { validationFailed } from '../platform/errors/app-error.js';
import type { RuleOperator } from '../modules/configuration/domain/types.js';
import { MISSING, isMissing, type ResolvedValue } from './json-path-resolver.js';

export type OperatorFn = (resolved: ResolvedValue, expected: unknown, extras?: OperatorExtras) => boolean;

export interface OperatorExtras {
  compiledRegex?: RegExp;
}

const registry = new Map<RuleOperator, OperatorFn>();

export function normalizeOperatorName(operator: string): string {
  return operator.trim().toUpperCase().replace(/-/g, '_');
}

export function isRegisteredOperator(operator: string): boolean {
  return registry.has(normalizeOperatorName(operator) as RuleOperator);
}

export function normalizeOperator(operator: string): RuleOperator {
  const normalized = normalizeOperatorName(operator) as RuleOperator;
  if (!registry.has(normalized)) {
    throw validationFailed('OPTIC-WF-40031', `Rule operator ${operator} is not supported.`, [
      { field: 'operator', path: 'operator', message: `Unknown operator ${operator}` }
    ]);
  }
  return normalized;
}

export function evaluateOperator(
  operator: string,
  resolved: ResolvedValue,
  expected: unknown,
  extras?: OperatorExtras
): boolean {
  const key = normalizeOperator(operator);
  const fn = registry.get(key);
  if (!fn) {
    throw validationFailed('OPTIC-WF-40031', `Rule operator ${operator} is not supported.`);
  }
  return fn(resolved, expected, extras);
}

function register(operator: RuleOperator, fn: OperatorFn): void {
  registry.set(operator, fn);
}

function sameType(left: unknown, right: unknown): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return typeof left === typeof right;
}

register('EQUALS', (resolved, expected) => {
  if (isMissing(resolved)) {
    return false;
  }
  if (typeof resolved === 'string' && typeof expected === 'string') {
    const leftDate = calendarDateKey(resolved);
    const rightDate = calendarDateKey(expected);
    if (leftDate && rightDate) {
      return leftDate === rightDate;
    }
  }
  if (!sameType(resolved, expected)) {
    return false;
  }
  return Object.is(resolved, expected);
});

register('NOT_EQUALS', (resolved, expected) => !evaluateOperator('EQUALS', resolved, expected));

register('IN', (resolved, expected) => {
  if (isMissing(resolved) || !Array.isArray(expected)) {
    return false;
  }
  return expected.some((item) => evaluateOperator('EQUALS', resolved, item));
});

register('NOT_IN', (resolved, expected) => !evaluateOperator('IN', resolved, expected));

register('EXISTS', (resolved) => !isMissing(resolved));
register('NOT_EXISTS', (resolved) => isMissing(resolved));
register('IS_NULL', (resolved) => !isMissing(resolved) && resolved === null);
register('NOT_NULL', (resolved) => !isMissing(resolved) && resolved !== null);

register('TRUE', (resolved) => resolved === true);
register('FALSE', (resolved) => resolved === false);

register('CONTAINS', (resolved, expected) => {
  if (isMissing(resolved)) {
    return false;
  }
  if (typeof resolved === 'string' && typeof expected === 'string') {
    return resolved.includes(expected);
  }
  if (Array.isArray(resolved)) {
    return resolved.some((item) => evaluateOperator('EQUALS', item, expected));
  }
  return false;
});

register('STARTS_WITH', (resolved, expected) => {
  return typeof resolved === 'string' && typeof expected === 'string' && resolved.startsWith(expected);
});

register('ENDS_WITH', (resolved, expected) => {
  return typeof resolved === 'string' && typeof expected === 'string' && resolved.endsWith(expected);
});

register('MATCHES', (resolved, _expected, extras) => {
  if (typeof resolved !== 'string' || !extras?.compiledRegex) {
    return false;
  }
  return extras.compiledRegex.test(resolved);
});

register('GREATER_THAN', (resolved, expected) => compare(resolved, expected) > 0);
register('GTE', (resolved, expected) => compare(resolved, expected) >= 0);
register('LESS_THAN', (resolved, expected) => compare(resolved, expected) < 0);
register('LTE', (resolved, expected) => compare(resolved, expected) <= 0);

function compare(resolved: ResolvedValue, expected: unknown): number {
  if (isMissing(resolved) || resolved === null || expected === null || expected === undefined) {
    throw validationFailed('OPTIC-WF-40032', 'Comparison operators cannot evaluate missing or null values.');
  }
  if (typeof resolved === 'number' && typeof expected === 'number') {
    return resolved === expected ? 0 : resolved > expected ? 1 : -1;
  }
  if (typeof resolved === 'string' && typeof expected === 'string') {
    const leftDate = calendarDateKey(resolved);
    const rightDate = calendarDateKey(expected);
    if (leftDate && rightDate) {
      return leftDate === rightDate ? 0 : leftDate > rightDate ? 1 : -1;
    }
  }
  throw validationFailed(
    'OPTIC-WF-40033',
    'Comparison requires matching number or date types. String-to-number coercion is not performed.'
  );
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Calendar day key (YYYY-MM-DD) for ISO date or date-time strings. */
function calendarDateKey(value: string): string | undefined {
  if (!isIsoDate(value)) {
    return undefined;
  }
  return value.slice(0, 10);
}

export function listedOperators(): RuleOperator[] {
  return [...registry.keys()];
}

export { MISSING };
