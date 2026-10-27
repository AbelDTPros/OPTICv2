import { validationFailed } from '../platform/errors/app-error.js';
import type { DefinitionRelease, RuleExpression } from '../modules/configuration/domain/types.js';
import { regexKey, type CompiledRegexMap } from './evaluator.js';
import { resolveJsonPath } from './json-path-resolver.js';
import { isRegisteredOperator } from './operators.js';
import { walkPredicates } from './parser.js';

export function compileRuleExpressions(release: DefinitionRelease): CompiledRegexMap {
  const compiled = new Map<string, RegExp>();
  for (const set of release.workflow.transitionSets) {
    for (const rule of set.rules) {
      compileExpression(rule.when, compiled, `${set.transitionSetKey}.${rule.ruleKey}`);
    }
  }
  for (const form of Object.values(release.forms)) {
    for (const behavior of form.behaviors ?? []) {
      compileExpression(behavior.when, compiled, `${form.formKey}.${behavior.behaviorKey}`);
    }
  }
  return compiled;
}

function compileExpression(expression: RuleExpression, compiled: CompiledRegexMap, source: string): void {
  walkPredicates(expression, (predicate) => {
    if (!isRegisteredOperator(predicate.operator)) {
      throw validationFailed(
        'OPTIC-CONFIG-40024',
        `Rule ${source} uses an unsupported operator.`,
        [
          {
            field: 'operator',
            path: predicate.path,
            message: `Unknown operator ${predicate.operator}`
          }
        ]
      );
    }
    try {
      resolveJsonPath(predicate.path, { businessData: {}, workflow: {} });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSONPath';
      throw validationFailed('OPTIC-CONFIG-40024', `Rule ${source} has an invalid JSONPath.`, [
        { field: 'path', path: predicate.path, message }
      ]);
    }
    if (predicate.operator.toUpperCase() !== 'MATCHES') {
      return;
    }
    if (typeof predicate.value !== 'string' || predicate.value.length === 0) {
      throw validationFailed('OPTIC-CONFIG-40022', `MATCHES rule ${source} must provide a regex string.`, [
        { field: 'value', path: predicate.path, message: 'Regex pattern is required' }
      ]);
    }
    try {
      compiled.set(regexKey(predicate.path, predicate.value), new RegExp(predicate.value));
    } catch {
      throw validationFailed('OPTIC-CONFIG-40022', `MATCHES rule ${source} has an invalid regex.`, [
        { field: 'value', path: predicate.path, message: 'Invalid regular expression' }
      ]);
    }
  });
}
