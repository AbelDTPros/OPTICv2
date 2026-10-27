import { validationFailed } from '../platform/errors/app-error.js';
import type { RuleExpression } from '../modules/configuration/domain/types.js';
import { isMissing, resolveJsonPath, type ResolveContext } from './json-path-resolver.js';
import { evaluateOperator, type OperatorExtras } from './operators.js';
import { isAll, isAny, isNot, isPredicate } from './parser.js';
import { describeResolved, type TraceEntry } from './trace.js';

const MAX_DEPTH = 8;
const MAX_EXPRESSIONS = 50;

export interface EvaluationResult {
  matched: boolean;
  trace: TraceEntry[];
}

export type CompiledRegexMap = Map<string, RegExp>;

interface EvalBox {
  count: number;
  trace: TraceEntry[];
}

export function regexKey(path: string, pattern: string): string {
  return `${path}::${pattern}`;
}

function looksLikeJsonPath(value: string): boolean {
  return value.startsWith('$.') || value.startsWith('$workflow.');
}

export function evaluateExpression(
  expression: RuleExpression,
  context: ResolveContext,
  extras: { compiledRegexes?: CompiledRegexMap } = {},
  box: EvalBox = { count: 0, trace: [] },
  depth = 0
): EvaluationResult {
  if (depth > MAX_DEPTH) {
    throw validationFailed('OPTIC-WF-40034', 'Rule expression exceeded the maximum nesting depth.');
  }
  box.count += 1;
  if (box.count > MAX_EXPRESSIONS) {
    throw validationFailed('OPTIC-WF-40035', 'Rule expression exceeded the maximum predicate count.');
  }

  if (isAll(expression)) {
    let matched = true;
    for (const child of expression.all) {
      const result = evaluateExpression(child, context, extras, box, depth + 1);
      if (!result.matched) {
        matched = false;
      }
    }
    return { matched, trace: box.trace };
  }

  if (isAny(expression)) {
    let matched = false;
    for (const child of expression.any) {
      const result = evaluateExpression(child, context, extras, box, depth + 1);
      if (result.matched) {
        matched = true;
      }
    }
    return { matched, trace: box.trace };
  }

  if (isNot(expression)) {
    const inner = evaluateExpression(expression.not, context, extras, box, depth + 1);
    return { matched: !inner.matched, trace: box.trace };
  }

  if (!isPredicate(expression)) {
    throw validationFailed('OPTIC-WF-40036', 'Rule expression is not a supported all/any/not/predicate form.');
  }

  try {
    const resolved = resolveJsonPath(expression.path, context);
    let expected = expression.value;
    if (typeof expected === 'string' && looksLikeJsonPath(expected)) {
      const right = resolveJsonPath(expected, context);
      if (isMissing(right)) {
        box.trace.push({
          path: expression.path,
          operator: expression.operator.toUpperCase(),
          result: 'NO_MATCH',
          ...describeResolved(expression.path, resolved, isMissing(resolved))
        });
        return { matched: false, trace: box.trace };
      }
      expected = right;
    }
    const operatorExtras: OperatorExtras = {};
    if (expression.operator.toUpperCase() === 'MATCHES' && typeof expected === 'string') {
      operatorExtras.compiledRegex = extras.compiledRegexes?.get(regexKey(expression.path, expected));
    }
    const matched = evaluateOperator(expression.operator, resolved, expected, operatorExtras);
    box.trace.push({
      path: expression.path,
      operator: expression.operator.toUpperCase(),
      result: matched ? 'MATCH' : 'NO_MATCH',
      ...describeResolved(expression.path, resolved, isMissing(resolved))
    });
    return { matched, trace: box.trace };
  } catch (error) {
    box.trace.push({
      path: expression.path,
      operator: expression.operator,
      result: 'ERROR',
      message: error instanceof Error ? error.message : 'Rule evaluation failed'
    });
    throw error;
  }
}
