import type { QueryExecutor } from '../../../platform/db/types.js';
import { readSchemaFromManifest } from '../domain/lifecycle.js';
import type {
  ActionDefinition,
  BulkActionDefinition,
  DefinitionRelease,
  DefinitionReleaseRecord,
  QueueDefinition,
  ScheduledActionDefinition,
  SearchDefinition,
  SlaDefinition,
  StageFormDefinition,
  WorkflowDefinition
} from '../domain/types.js';
import { EMPTY_SEARCH, EMPTY_WORKFLOW } from '../domain/types.js';
import type { DefinitionRepository } from '../persistence/definition.repository.js';

function readRejectedComment(manifest: Record<string, unknown>): string | null {
  const metadata = (manifest.metadata ?? {}) as Record<string, unknown>;
  return typeof metadata.rejectedComment === 'string' ? metadata.rejectedComment : null;
}

export async function assembleDefinitionRelease(
  repository: DefinitionRepository,
  release: DefinitionReleaseRecord,
  executor?: QueryExecutor
): Promise<DefinitionRelease> {
  const stages = await repository.listChildren(release.id, 'stage', executor);
  const transitions = await repository.listChildren(release.id, 'transition', executor);
  const forms = await repository.listChildren(release.id, 'form', executor);
  const actions = await repository.listChildren(release.id, 'action', executor);
  const queues = await repository.listChildren(release.id, 'queue', executor);
  const bulkActions = await repository.listChildren(release.id, 'bulkAction', executor);
  const scheduledActions = await repository.listChildren(release.id, 'scheduledAction', executor);
  const slas = await repository.listChildren(release.id, 'sla', executor);
  const searchRows = await repository.listChildren(release.id, 'search', executor);
  const spec = (release.manifest.spec ?? {}) as Record<string, unknown>;
  const workflowGraph = (spec.workflowGraph ?? {}) as {
    initialStageKey?: string;
    terminalStageKeys?: string[];
  };
  const search = (searchRows[0]?.config as SearchDefinition | undefined) ?? EMPTY_SEARCH;
  const definition = await repository.findDefinitionByKey(release.definitionKey, executor);

  return {
    id: String(release.id),
    definitionKey: release.definitionKey,
    displayName: release.displayName,
    entityType: release.entityType,
    version: release.version,
    lifecycleStatus: release.lifecycleStatus,
    active: definition?.activeReleaseId === release.id,
    schema: readSchemaFromManifest(release.manifest),
    workflow: {
      initialStageKey: workflowGraph.initialStageKey ?? EMPTY_WORKFLOW.initialStageKey,
      terminalStageKeys: workflowGraph.terminalStageKeys ?? EMPTY_WORKFLOW.terminalStageKeys,
      stages: stages.map((row) => row.config as unknown as WorkflowDefinition['stages'][number]),
      transitionSets: transitions.map(
        (row) => row.config as unknown as WorkflowDefinition['transitionSets'][number]
      )
    },
    forms: Object.fromEntries(forms.map((row) => [row.stableKey, row.config as unknown as StageFormDefinition])),
    actions: Object.fromEntries(actions.map((row) => [row.stableKey, row.config as unknown as ActionDefinition])),
    queues: Object.fromEntries(queues.map((row) => [row.stableKey, row.config as unknown as QueueDefinition])),
    bulkActions: Object.fromEntries(
      bulkActions.map((row) => [row.stableKey, row.config as unknown as BulkActionDefinition])
    ),
    scheduledActions: Object.fromEntries(
      scheduledActions.map((row) => [row.stableKey, row.config as unknown as ScheduledActionDefinition])
    ),
    slas: Object.fromEntries(slas.map((row) => [row.stableKey, row.config as unknown as SlaDefinition])),
    search,
    checksum: release.checksum ?? undefined,
    submittedBy: release.submittedBy,
    approvedBy: release.approvedBy,
    publishedBy: release.publishedBy,
    rejectedComment: readRejectedComment(release.manifest),
    rowVersion: release.rowVersion
  };
}
