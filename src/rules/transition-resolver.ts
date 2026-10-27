import { validationFailed } from '../platform/errors/app-error.js';
import type { TransitionSet } from '../modules/configuration/domain/types.js';
import { evaluateExpression, type CompiledRegexMap } from './evaluator.js';
import type { ResolveContext } from './json-path-resolver.js';
import type { TraceEntry } from './trace.js';

export interface TransitionDecision {
  targetStageKey: string;
  matchedRuleKey?: string;
  usedDefault: boolean;
  trace: TraceEntry[];
}

export function resolveTransition(
  transitionSet: TransitionSet,
  context: ResolveContext,
  compiledRegexes?: CompiledRegexMap
): TransitionDecision {
  const frozenContext: ResolveContext = {
    businessData: freezeDeep(cloneInput(context.businessData)),
    workflow: context.workflow ? { ...context.workflow } : undefined
  };
  const ordered = [...transitionSet.rules].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.ruleKey.localeCompare(right.ruleKey);
  });
  const trace: TraceEntry[] = [];

  for (const rule of ordered) {
    const evaluation = evaluateExpression(rule.when, frozenContext, { compiledRegexes }, { count: 0, trace });
    trace.push({
      ruleKey: rule.ruleKey,
      result: evaluation.matched ? 'MATCH' : 'NO_MATCH',
      message: rule.description
    });
    if (evaluation.matched) {
      return {
        targetStageKey: rule.targetStageKey,
        matchedRuleKey: rule.ruleKey,
        usedDefault: false,
        trace
      };
    }
  }

  if (!transitionSet.defaultTargetStageKey) {
    throw validationFailed(
      'OPTIC-WF-40037',
      `Transition set ${transitionSet.transitionSetKey} matched no rule and has no defaultTargetStageKey.`
    );
  }

  return {
    targetStageKey: transitionSet.defaultTargetStageKey,
    usedDefault: true,
    trace
  };
}

function cloneInput(value: unknown): unknown {
  try {
    return structuredClone(value ?? {});
  } catch {
    throw validationFailed('OPTIC-WF-40038', 'Simulation input could not be cloned into an immutable evaluation context.');
  }
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      freezeDeep(child);
    }
  }
  return value;
}
