import type { CompiledRegexMap } from '../../../rules/evaluator.js';
import { collectProjectionRequirements } from '../../queue/domain/projection-requirements.js';
import type { DefinitionRelease } from '../domain/types.js';
import type { CompiledSchemaValidator } from './schema-compiler.js';

export interface CompiledDefinition {
  releaseId: string;
  definitionKey: string;
  version: string;
  lifecycleStatus: DefinitionRelease['lifecycleStatus'];
  rowVersion: number;
  cacheKey: string;
  release: DefinitionRelease;
  schema: CompiledSchemaValidator;
  compiledRegexes: CompiledRegexMap;
}

export interface CompiledDefinitionSummary {
  releaseId: string;
  definitionKey: string;
  version: string;
  lifecycleStatus: DefinitionRelease['lifecycleStatus'];
  rowVersion: number;
  cacheKey: string;
  cacheHit: boolean;
  schemaCompiled: boolean;
  stageKeys: string[];
  actionKeys: string[];
  formKeys: string[];
  queueKeys: string[];
  projectionFields: string[];
}

export function toCompiledSummary(compiled: CompiledDefinition, cacheHit: boolean): CompiledDefinitionSummary {
  return {
    releaseId: compiled.releaseId,
    definitionKey: compiled.definitionKey,
    version: compiled.version,
    lifecycleStatus: compiled.lifecycleStatus,
    rowVersion: compiled.rowVersion,
    cacheKey: compiled.cacheKey,
    cacheHit,
    schemaCompiled: compiled.schema.compiled,
    stageKeys: compiled.release.workflow.stages.map((stage) => stage.stageKey),
    actionKeys: Object.keys(compiled.release.actions),
    formKeys: Object.keys(compiled.release.forms),
    queueKeys: Object.keys(compiled.release.queues),
    projectionFields: collectProjectionRequirements(compiled.release).map((field) => field.key)
  };
}
