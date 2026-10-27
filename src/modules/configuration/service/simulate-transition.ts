import { validationFailed } from '../../../platform/errors/app-error.js';
import { resolveTransition, type TransitionDecision } from '../../../rules/transition-resolver.js';
import type { CompiledDefinition } from '../definitions/compiled-definition.js';
import type { DefinitionLoader } from '../definitions/definition-loader.js';

export interface SimulateTransitionInput {
  transitionSetKey: string;
  businessData?: unknown;
  workflowContext?: Record<string, unknown>;
}

export interface SimulateTransitionResult extends TransitionDecision {
  definitionKey: string;
  version: string;
  transitionSetKey: string;
}

export async function simulateTransition(
  loader: DefinitionLoader,
  definitionKey: string,
  version: string,
  input: SimulateTransitionInput
): Promise<SimulateTransitionResult> {
  const compiled = await loader.loadByKeyVersion(definitionKey, version);
  return simulateCompiledTransition(compiled, input);
}

export function simulateCompiledTransition(
  compiled: CompiledDefinition,
  input: SimulateTransitionInput
): SimulateTransitionResult {
  const transitionSet = compiled.release.workflow.transitionSets.find(
    (set) => set.transitionSetKey === input.transitionSetKey
  );
  if (!transitionSet) {
    throw validationFailed(
      'OPTIC-CONFIG-40023',
      `Transition set ${input.transitionSetKey} was not found on ${compiled.definitionKey} ${compiled.version}.`,
      [
        {
          field: 'transitionSetKey',
          path: 'transitionSetKey',
          message: `Unknown transition set ${input.transitionSetKey}`
        }
      ]
    );
  }

  const decision = resolveTransition(
    transitionSet,
    {
      businessData: input.businessData ?? {},
      workflow: input.workflowContext
    },
    compiled.compiledRegexes
  );

  return {
    definitionKey: compiled.definitionKey,
    version: compiled.version,
    transitionSetKey: input.transitionSetKey,
    ...decision
  };
}
