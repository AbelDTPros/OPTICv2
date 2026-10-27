import type { RuleExpression, RulePredicate } from '../modules/configuration/domain/types.js';

export function isPredicate(expression: RuleExpression): expression is RulePredicate {
  return 'path' in expression && 'operator' in expression;
}

export function isAll(expression: RuleExpression): expression is { all: RuleExpression[] } {
  return 'all' in expression;
}

export function isAny(expression: RuleExpression): expression is { any: RuleExpression[] } {
  return 'any' in expression;
}

export function isNot(expression: RuleExpression): expression is { not: RuleExpression } {
  return 'not' in expression;
}

export function walkPredicates(expression: RuleExpression, visit: (predicate: RulePredicate) => void): void {
  if (isPredicate(expression)) {
    visit(expression);
    return;
  }
  if (isAll(expression)) {
    expression.all.forEach((child) => walkPredicates(child, visit));
    return;
  }
  if (isAny(expression)) {
    expression.any.forEach((child) => walkPredicates(child, visit));
    return;
  }
  walkPredicates(expression.not, visit);
}
