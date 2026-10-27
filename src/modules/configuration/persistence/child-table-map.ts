import type { DefinitionChildKind } from './definition.repository.js';

export const CHILD_TABLES: Record<
  DefinitionChildKind,
  { table: string; keyColumn: string }
> = {
  stage: { table: 'stage_definition', keyColumn: 'stage_key' },
  transition: { table: 'transition_definition', keyColumn: 'transition_set_key' },
  form: { table: 'form_definition', keyColumn: 'form_key' },
  action: { table: 'action_definition', keyColumn: 'action_key' },
  queue: { table: 'queue_definition', keyColumn: 'queue_key' },
  bulkAction: { table: 'bulk_action_definition', keyColumn: 'bulk_action_key' },
  scheduledAction: { table: 'scheduled_action_definition', keyColumn: 'scheduled_action_key' },
  sla: { table: 'sla_definition', keyColumn: 'sla_key' },
  search: { table: 'search_definition', keyColumn: 'search_key' }
};

export const ALL_CHILD_KINDS = Object.keys(CHILD_TABLES) as DefinitionChildKind[];
