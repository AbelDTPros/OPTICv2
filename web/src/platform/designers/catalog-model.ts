import { isMailDefinitionKey } from '../../../../src/modules/configuration/domain/kind-key.js';
import type {
  ActionDefinition,
  BulkActionDefinition,
  QueueDefinition,
  QueueProjectedField,
  ScheduledActionDefinition,
  SearchDefinition,
  SearchFieldDefinition,
  SlaDefinition,
  StageFormDefinition,
  WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import type { DesignerIssue } from './form-model.js';
import { blankEligibilityPredicate, type EligibilityNode } from './EligibilityEditor.js';
import { listProjectableFormFields } from './workflow-model.js';

const STABLE = /^[A-Z][A-Z0-9_]*$/;
const PAGE_SIZES = new Set([10, 25, 50, 100]);

export function blankAction(): ActionDefinition {
  return {
    actionKey: 'ACTION',
    label: 'New action',
    type: 'TRANSITION',
    requireAssignmentToCurrentUser: false,
    validation: { validateStageForm: false }
  };
}

export const ENTITY_TYPE_OPTIONS = [
  { value: 'WORKLOAD', label: 'Workload' },
  { value: 'MAIL', label: 'Mail item' }
] as const;

export function normalizeEntityType(value?: string): 'WORKLOAD' | 'MAIL' {
  return value === 'MAIL' ? 'MAIL' : 'WORKLOAD';
}

export function entityTypeForCatalogItem(item: {
  definitionKey: string;
  entityType?: string;
}): 'WORKLOAD' | 'MAIL' {
  if (item.entityType) {
    return normalizeEntityType(item.entityType);
  }
  return isMailDefinitionKey(item.definitionKey) ? 'MAIL' : 'WORKLOAD';
}

export function entityTypeOptionLabel(entityType: 'WORKLOAD' | 'MAIL'): string {
  return ENTITY_TYPE_OPTIONS.find((option) => option.value === entityType)?.label ?? entityType;
}

export function blankQueue(entityType = 'WORKLOAD'): QueueDefinition {
  return {
    queueKey: 'QUEUE',
    displayName: 'New queue',
    entityType: normalizeEntityType(entityType),
    eligibility: { all: [blankEligibilityPredicate('QUEUE')] } as Record<string, unknown>,
    defaultSort: [{ field: 'enteredStageAt', direction: 'ASC' }],
    columns: ['trackingId', 'assignedTo'],
    filters: ['assignedStatus'],
    actions: ['ASSIGN_TO_SELF', 'RELEASE_TO_QUEUE'],
    pageSize: 25,
    projectedFields: []
  };
}

export function nextProjectedField(existing: QueueProjectedField[] = []): QueueProjectedField {
  const used = new Set(existing.map((field) => field.fieldKey));
  const preferred = ['firstName', 'lastName'];
  const fieldKey =
    preferred.find((key) => !used.has(key)) ??
    (() => {
      let index = 1;
      while (used.has(`field${index}`)) {
        index += 1;
      }
      return `field${index}`;
    })();
  const labels: Record<string, string> = {
    firstName: 'Applicant First Name',
    lastName: 'Applicant Last Name'
  };
  return {
    fieldKey,
    label: labels[fieldKey] ?? 'New field',
    path: `$.dataEntryDetails.${fieldKey}`
  };
}

export function blankSla(): SlaDefinition {
  return {
    slaKey: 'SLA',
    clock: 'CALENDAR',
    target: { durationHours: 24 },
    warningThresholdPercent: 75,
    breachThresholdPercent: 100,
    severityOnBreach: 'HIGH'
  };
}

export const BUILTIN_SEARCH_FIELD_KEYS = [
  'trackingId',
  'receiptNumber',
  'currentStageKey',
  'assignedTo'
] as const;

export type BuiltinSearchFieldKey = (typeof BUILTIN_SEARCH_FIELD_KEYS)[number];

export const BUILTIN_SEARCH_FIELD_DEFAULTS: SearchFieldDefinition[] = [
  {
    fieldKey: 'trackingId',
    source: 'SYSTEM',
    path: '$workflow.trackingId',
    match: 'CONTAINS',
    pii: false,
    useInSearch: true,
    useInDashboard: false
  },
  {
    fieldKey: 'receiptNumber',
    source: 'SYSTEM',
    path: '$workflow.receiptNumber',
    match: 'EXACT_PREFIX',
    pii: true,
    useInSearch: true,
    useInDashboard: false
  },
  {
    fieldKey: 'currentStageKey',
    source: 'SYSTEM',
    path: '$workflow.currentStageKey',
    match: 'EXACT_PREFIX',
    pii: false,
    useInSearch: true,
    useInDashboard: false
  },
  {
    fieldKey: 'assignedTo',
    source: 'SYSTEM',
    path: '$workflow.assignedTo',
    match: 'EXACT_PREFIX',
    pii: false,
    useInSearch: true,
    useInDashboard: false
  }
];

export function fieldUsedInSearch(field: SearchFieldDefinition): boolean {
  return field.useInSearch !== false;
}

export function fieldUsedInDashboard(field: SearchFieldDefinition): boolean {
  return field.useInDashboard === true;
}

export const BUILTIN_SEARCH_FIELD_LABELS: Record<BuiltinSearchFieldKey, string> = {
  trackingId: 'Tracking ID',
  receiptNumber: 'Receipt number',
  currentStageKey: 'Stage',
  assignedTo: 'Assignee'
};

export function isBuiltinSearchFieldKey(fieldKey: string): fieldKey is BuiltinSearchFieldKey {
  return (BUILTIN_SEARCH_FIELD_KEYS as readonly string[]).includes(fieldKey);
}

export function resolveSearchField(
  search: SearchDefinition,
  fieldKey: BuiltinSearchFieldKey
): SearchFieldDefinition {
  return (
    search.fields.find((field) => field.fieldKey === fieldKey) ??
    BUILTIN_SEARCH_FIELD_DEFAULTS.find((field) => field.fieldKey === fieldKey)!
  );
}

export function upsertSearchField(search: SearchDefinition, field: SearchFieldDefinition): SearchDefinition {
  const index = search.fields.findIndex((item) => item.fieldKey === field.fieldKey);
  if (index >= 0) {
    return {
      ...search,
      fields: search.fields.map((item, itemIndex) => (itemIndex === index ? field : item))
    };
  }
  return { ...search, fields: [...search.fields, field] };
}

export function extraSearchFields(
  search: SearchDefinition
): Array<{ field: SearchFieldDefinition; index: number }> {
  return search.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => !isBuiltinSearchFieldKey(field.fieldKey));
}

/** Extra indexed fields shown on Workspace Find a case. */
export function extraFindSearchFields(
  search: SearchDefinition
): Array<{ field: SearchFieldDefinition; index: number }> {
  return extraSearchFields(search).filter(({ field }) => fieldUsedInSearch(field));
}

/** Extra indexed fields marked as Dashboard dimensions. */
export function extraDashboardFields(
  search: SearchDefinition
): Array<{ field: SearchFieldDefinition; index: number }> {
  return extraSearchFields(search).filter(({ field }) => fieldUsedInDashboard(field));
}

export interface ProjectedSearchOption {
  fieldKey: string;
  path: string;
  label: string;
  group?: string;
}

/** Form fields officers can add to Find a case (grouped like Queue projected-field picker). */
export function listFormSearchOptions(
  forms: Record<string, StageFormDefinition>,
  workflow?: WorkflowDefinition
): ProjectedSearchOption[] {
  const byPath = new Map<string, ProjectedSearchOption>();
  for (const field of listProjectableFormFields(forms, workflow)) {
    if (!field.path.trim() || isBuiltinSearchFieldKey(field.fieldKey) || byPath.has(field.path)) {
      continue;
    }
    byPath.set(field.path, {
      fieldKey: field.fieldKey,
      path: field.path,
      label: field.label,
      group: field.group
    });
  }
  return [...byPath.values()].sort((left, right) => {
    const byGroup = (left.group ?? '').localeCompare(right.group ?? '');
    if (byGroup !== 0) {
      return byGroup;
    }
    return left.label.localeCompare(right.label);
  });
}

/**
 * Copies a Find a case form field onto one queue projection so search can match it.
 * Does not add a queue column — only ensures projected JSON includes the value.
 */
export function ensureSearchFieldProjected(
  queues: Record<string, QueueDefinition>,
  field: Pick<ProjectedSearchOption, 'fieldKey' | 'label' | 'path'>
): Record<string, QueueDefinition> {
  if (Object.keys(queues).length === 0) {
    return queues;
  }
  const alreadyProjected = Object.values(queues).some((queue) =>
    (queue.projectedFields ?? []).some((item) => item.path === field.path)
  );
  if (alreadyProjected) {
    return queues;
  }
  const queueKeys = Object.keys(queues);
  const targetKey =
    queueKeys.find((key) => (queues[key]?.projectedFields?.length ?? 0) > 0) ?? queueKeys[0]!;
  const target = queues[targetKey]!;
  const usedKeys = new Set((target.projectedFields ?? []).map((item) => item.fieldKey));
  const fieldKey = uniqueSearchProjectedKey(field.fieldKey, usedKeys);
  return {
    ...queues,
    [targetKey]: {
      ...target,
      projectedFields: [
        ...(target.projectedFields ?? []),
        { fieldKey, label: field.label, path: field.path }
      ]
    }
  };
}

/**
 * Drops auto-added queue projections for a removed Find a case filter.
 * Keeps the field when it is still a queue column, or another search filter still uses the path.
 */
export function removeSearchFieldProjection(
  queues: Record<string, QueueDefinition>,
  removed: Pick<SearchFieldDefinition, 'path' | 'fieldKey'>,
  remainingSearch: SearchDefinition
): Record<string, QueueDefinition> {
  const pathKey = removed.path.trim().toLowerCase();
  if (!pathKey || Object.keys(queues).length === 0) {
    return queues;
  }
  const stillNeeded = remainingSearch.fields.some(
    (field) =>
      field.path.trim().toLowerCase() === pathKey &&
      (fieldUsedInSearch(field) || fieldUsedInDashboard(field))
  );
  if (stillNeeded) {
    return queues;
  }
  let changed = false;
  const next: Record<string, QueueDefinition> = {};
  for (const [queueKey, queue] of Object.entries(queues)) {
    const columns = new Set(queue.columns ?? []);
    const projectedFields = queue.projectedFields ?? [];
    const kept = projectedFields.filter((item) => {
      if (item.path.trim().toLowerCase() !== pathKey) {
        return true;
      }
      // Officer-facing queue columns stay; only search-only projections are pruned.
      if (columns.has(item.fieldKey)) {
        return true;
      }
      changed = true;
      return false;
    });
    next[queueKey] = kept.length === projectedFields.length ? queue : { ...queue, projectedFields: kept };
  }
  return changed ? next : queues;
}

function uniqueSearchProjectedKey(preferred: string, used: Set<string>): string {
  const base = preferred.replace(/[^A-Za-z0-9_]/g, '_') || 'field';
  const start = /^[A-Za-z]/.test(base) ? base : `f_${base}`;
  if (!used.has(start)) {
    return start;
  }
  let index = 2;
  while (used.has(`${start}${index}`)) {
    index += 1;
  }
  return `${start}${index}`;
}

/** Unique queue projected fields that can back Catalog Search extras / Find a case. */
export function listProjectedSearchOptions(
  queues: Record<string, QueueDefinition>
): ProjectedSearchOption[] {
  const byKey = new Map<string, ProjectedSearchOption>();
  for (const queue of Object.values(queues)) {
    for (const field of queue.projectedFields ?? []) {
      if (!field.fieldKey.trim() || isBuiltinSearchFieldKey(field.fieldKey) || byKey.has(field.fieldKey)) {
        continue;
      }
      byKey.set(field.fieldKey, {
        fieldKey: field.fieldKey,
        path: field.path,
        label: field.label.trim() || field.fieldKey
      });
    }
  }
  // Same officer-facing label on multiple queues → one Find a case choice.
  const byLabel = new Map<string, ProjectedSearchOption>();
  for (const option of byKey.values()) {
    const labelKey = option.label.toLowerCase();
    const existing = byLabel.get(labelKey);
    byLabel.set(labelKey, existing ? preferProjectedSearchOption(existing, option) : option);
  }
  return [...byLabel.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function preferProjectedSearchOption(
  left: ProjectedSearchOption,
  right: ProjectedSearchOption
): ProjectedSearchOption {
  const leftLeaf = pathLeafKey(left.path);
  const rightLeaf = pathLeafKey(right.path);
  const leftCanonical = left.fieldKey === leftLeaf;
  const rightCanonical = right.fieldKey === rightLeaf;
  if (leftCanonical !== rightCanonical) {
    return rightCanonical ? right : left;
  }
  if (left.fieldKey.length !== right.fieldKey.length) {
    return left.fieldKey.length <= right.fieldKey.length ? left : right;
  }
  return left.fieldKey.localeCompare(right.fieldKey) <= 0 ? left : right;
}

/** Extras only once per projected Find a case input (Status vs workloadStatus collapse together). */
export function uniqueExtraSearchFields(
  search: SearchDefinition,
  options: ProjectedSearchOption[]
): Array<{ field: SearchFieldDefinition; index: number }> {
  const seen = new Set<string>();
  const unique: Array<{ field: SearchFieldDefinition; index: number }> = [];
  for (const entry of extraSearchFields(search)) {
    const matched = projectedOptionForSearchField(entry.field, options);
      const identity = (matched?.path ?? entry.field.path ?? entry.field.fieldKey).toLowerCase();
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    unique.push(entry);
  }
  return unique;
}

export function searchFieldFromProjected(option: ProjectedSearchOption): SearchFieldDefinition {
  return {
    fieldKey: option.fieldKey,
    source: 'BUSINESS_DATA',
    path: option.path,
    match: 'CONTAINS',
    pii: false,
    useInSearch: true,
    useInDashboard: false
  };
}

export function blankSearchField(projected?: ProjectedSearchOption): SearchFieldDefinition {
  if (projected) {
    return searchFieldFromProjected(projected);
  }
  return {
    fieldKey: 'customField',
    source: 'BUSINESS_DATA',
    path: '$.customField',
    match: 'EXACT_PREFIX',
    pii: false,
    useInSearch: true,
    useInDashboard: false
  };
}

export function projectedOptionForSearchField(
  field: SearchFieldDefinition,
  options: ProjectedSearchOption[]
): ProjectedSearchOption | undefined {
  return (
    options.find((option) => option.path === field.path) ??
    options.find((option) => option.fieldKey === field.fieldKey) ??
    options.find((option) => pathLeafKey(option.path) === pathLeafKey(field.path))
  );
}

export function groupProjectedSearchOptions(
  options: ProjectedSearchOption[]
): Array<{ group: string; items: ProjectedSearchOption[] }> {
  const order: string[] = [];
  const byGroup = new Map<string, ProjectedSearchOption[]>();
  for (const option of options) {
    const group = option.group?.trim() || 'Form fields';
    if (!byGroup.has(group)) {
      order.push(group);
      byGroup.set(group, []);
    }
    byGroup.get(group)!.push(option);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

function pathLeafKey(path: string): string {
  const cleaned = path.replace(/^\$workflow\.?/, '').replace(/^\$\.?/, '');
  const parts = cleaned.split('.').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function blankBulkAction(): BulkActionDefinition {
  return {
    bulkActionKey: 'BULK_ACTION',
    label: 'Bulk action',
    stageKey: 'STAGE',
    maxSelection: 25,
    transactionMode: 'BEST_EFFORT',
    eligibility: {
      requireUnassignedOrAssignedToCurrentUser: true,
      all: [blankEligibilityPredicate('STAGE')]
    },
    sharedInputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', title: 'Note' }
      }
    },
    writeMappings: [],
    transition: { targetStage: 'COMPLETED' }
  };
}

export function blankScheduledAction(): ScheduledActionDefinition {
  return {
    scheduledActionKey: 'SCHEDULED',
    trigger: { type: 'STAGE_ENTERED', stageKey: 'STAGE' },
    delay: { source: 'CONFIG', duration: { hours: 24 } },
    action: { type: 'NOTIFICATION' },
    cancellation: { cancelIfStageChanges: true },
    retry: { maxAttempts: 5, backoff: 'EXPONENTIAL' }
  };
}

export function collectActionIssues(action: ActionDefinition): DesignerIssue[] {
  const issues = collectKeyIssues('actionKey', action.actionKey, action.label);
  if ((action.type ?? 'TRANSITION') === 'TRANSITION' && !action.transitionSetKey) {
    issues.push({ path: 'transitionSetKey', message: 'Transition actions need a transitionSetKey.' });
  }
  return issues;
}

export function collectQueueIssues(queue: QueueDefinition): DesignerIssue[] {
  const issues = collectKeyIssues('queueKey', queue.queueKey, queue.displayName);
  if (!PAGE_SIZES.has(queue.pageSize)) {
    issues.push({ path: 'pageSize', message: 'pageSize must be 10, 25, 50, or 100.' });
  }
  issues.push(...collectEligibilityIssues(queue.eligibility as EligibilityNode, 'eligibility'));
  if (queue.columns.length === 0) {
    issues.push({ path: 'columns', message: 'A queue needs at least one column.' });
  }
  const seen = new Set<string>();
  for (const [index, field] of (queue.projectedFields ?? []).entries()) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.fieldKey)) {
      issues.push({ path: `projectedFields.${index}.fieldKey`, message: 'Field key must start with a letter, for example firstName.' });
    } else if (seen.has(field.fieldKey)) {
      issues.push({ path: `projectedFields.${index}.fieldKey`, message: `Duplicate Field key ${field.fieldKey}.` });
    }
    seen.add(field.fieldKey);
    if (!field.label.trim()) {
      issues.push({ path: `projectedFields.${index}.label`, message: `${field.fieldKey || 'Field'} needs a column label.` });
    }
    if (!field.path.startsWith('$')) {
      issues.push({ path: `projectedFields.${index}.path`, message: `${field.fieldKey || 'Field'} needs a JSONPath starting with $.` });
    }
  }
  return issues;
}

export function collectSlaIssues(sla: SlaDefinition): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  if (!STABLE.test(sla.slaKey)) {
    issues.push({ path: 'slaKey', message: 'slaKey must be uppercase snake case.' });
  }
  if (sla.target.durationHours <= 0) {
    issues.push({ path: 'target.durationHours', message: 'SLA target hours must be positive.' });
  }
  return issues;
}

export function collectSearchIssues(
  search: SearchDefinition,
  queues: Record<string, QueueDefinition> = {},
  forms: Record<string, StageFormDefinition> = {},
  workflow?: WorkflowDefinition
): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const keys = new Set<string>();
  const formOptions = listFormSearchOptions(forms, workflow);
  const projected = listProjectedSearchOptions(queues);
  const linkable = formOptions.length > 0 ? formOptions : projected;
  for (const [index, field] of search.fields.entries()) {
    if (!field.fieldKey.trim()) {
      issues.push({ path: `fields.${index}.fieldKey`, message: 'Each search field needs a fieldKey.' });
    }
    if (field.fieldKey && keys.has(field.fieldKey)) {
      issues.push({ path: `fields.${index}.fieldKey`, message: `Duplicate search fieldKey ${field.fieldKey}.` });
    }
    keys.add(field.fieldKey);
    if (!field.path.trim()) {
      issues.push({ path: `fields.${index}.path`, message: `${field.fieldKey || 'Field'} needs a JSONPath.` });
    }
    if (
      !isBuiltinSearchFieldKey(field.fieldKey) &&
      linkable.length > 0 &&
      !projectedOptionForSearchField(field, linkable) &&
      !projectedOptionForSearchField(field, projected)
    ) {
      issues.push({
        path: `fields.${index}.fieldKey`,
        message: `${field.fieldKey || 'Extra field'} must use a form field so Find a case can match.`
      });
    }
  }
  return issues;
}

export function collectBulkIssues(bulk: BulkActionDefinition): DesignerIssue[] {
  const issues = collectKeyIssues('bulkActionKey', bulk.bulkActionKey, bulk.label);
  if (!STABLE.test(bulk.stageKey)) {
    issues.push({ path: 'stageKey', message: 'stageKey must be uppercase snake case.' });
  }
  if (bulk.maxSelection <= 0) {
    issues.push({ path: 'maxSelection', message: 'maxSelection must be a positive integer.' });
  }
  for (const [index, mapping] of (bulk.writeMappings ?? []).entries()) {
    if (!mapping.source.trim() || !mapping.target.trim()) {
      issues.push({
        path: `writeMappings.${index}`,
        message: 'Each write mapping needs a source and target JSONPath.'
      });
    }
  }
  if (
    bulk.eligibility &&
    ('all' in bulk.eligibility || 'any' in bulk.eligibility || 'not' in bulk.eligibility || 'source' in bulk.eligibility)
  ) {
    issues.push(...collectEligibilityIssues(eligibilityTreeOf(bulk.eligibility), 'eligibility'));
  }
  return issues;
}

export function collectScheduledIssues(scheduled: ScheduledActionDefinition): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  if (!STABLE.test(scheduled.scheduledActionKey)) {
    issues.push({ path: 'scheduledActionKey', message: 'scheduledActionKey must be uppercase snake case.' });
  }
  const stageKey = scheduled.trigger.stageKey;
  if (typeof stageKey !== 'string' || !STABLE.test(stageKey)) {
    issues.push({ path: 'trigger.stageKey', message: 'Trigger stageKey must be uppercase snake case.' });
  }
  if (scheduled.action?.type === 'TRANSITION') {
    const target = scheduled.action.targetStage;
    if (typeof target !== 'string' || !STABLE.test(target)) {
      issues.push({ path: 'action.targetStage', message: 'TRANSITION scheduled actions need a targetStage.' });
    }
  }
  if (scheduled.delay?.source === 'FIELD') {
    const path = scheduled.delay.path ?? scheduled.delay.field;
    if (typeof path !== 'string' || !(path.startsWith('$') || path.startsWith('$workflow'))) {
      issues.push({ path: 'delay.path', message: 'FIELD delay requires a JSONPath starting with $ or $workflow.' });
    }
  }
  return issues;
}

export function collectEligibilityIssues(node: EligibilityNode | undefined, path: string): DesignerIssue[] {
  if (!node || typeof node !== 'object') {
    return [{ path, message: 'Queue eligibility is required.' }];
  }
  if ('all' in node) {
    if (!Array.isArray(node.all) || node.all.length === 0) {
      return [{ path: `${path}.all`, message: 'Eligibility all[] cannot be empty. Add a stage predicate.' }];
    }
    return node.all.flatMap((child, index) => collectEligibilityIssues(child, `${path}.all.${index}`));
  }
  if ('any' in node) {
    if (!Array.isArray(node.any) || node.any.length === 0) {
      return [{ path: `${path}.any`, message: 'Eligibility any[] cannot be empty.' }];
    }
    return node.any.flatMap((child, index) => collectEligibilityIssues(child, `${path}.any.${index}`));
  }
  if ('not' in node) {
    return collectEligibilityIssues(node.not, `${path}.not`);
  }
  if (!('source' in node) || !node.field || !node.operator) {
    return [{ path, message: 'Each eligibility predicate needs source, field, and operator.' }];
  }
  return [];
}

export function asEligibilityNode(value: unknown): EligibilityNode {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const node = value as EligibilityNode;
    if ('all' in node || 'any' in node || 'not' in node || ('source' in node && node.field && node.operator)) {
      return node;
    }
  }
  return { all: [blankEligibilityPredicate()] };
}

export function eligibilityTreeOf(value: unknown): EligibilityNode {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rest = { ...(value as Record<string, unknown>) };
    delete rest.requireUnassignedOrAssignedToCurrentUser;
    return asEligibilityNode(rest);
  }
  return asEligibilityNode(value);
}

function collectKeyIssues(field: string, key: string, label: string): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  if (!STABLE.test(key)) {
    issues.push({ path: field, message: `${field} must be uppercase snake case.` });
  }
  if (!label.trim()) {
    issues.push({ path: 'label', message: 'A visible label is required.' });
  }
  return issues;
}
