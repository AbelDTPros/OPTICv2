export type JsonSchema = Record<string, unknown>;

export type DefinitionLifecycle =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'RETIRED'
  | 'REJECTED';

export type EntityType = 'MAIL' | 'WORKLOAD' | string;

export interface AssignmentPolicy {
  required: boolean;
  clearOnTransition: boolean;
  /** When omitted, assign is allowed on non-terminal stages only. */
  allowAssign?: boolean;
  /** When omitted, reassign is allowed on non-terminal stages only. */
  allowReassign?: boolean;
  /** When omitted, release is allowed on every stage. */
  allowRelease?: boolean;
}

export type RuleOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'IN'
  | 'NOT_IN'
  | 'EXISTS'
  | 'NOT_EXISTS'
  | 'IS_NULL'
  | 'NOT_NULL'
  | 'GREATER_THAN'
  | 'GTE'
  | 'LESS_THAN'
  | 'LTE'
  | 'CONTAINS'
  | 'STARTS_WITH'
  | 'ENDS_WITH'
  | 'MATCHES'
  | 'TRUE'
  | 'FALSE';

export interface RulePredicate {
  path: string;
  operator: RuleOperator;
  value?: unknown;
}

export type RuleExpression =
  | { all: RuleExpression[] }
  | { any: RuleExpression[] }
  | { not: RuleExpression }
  | RulePredicate;

export interface TransitionRule {
  ruleKey: string;
  priority: number;
  when: RuleExpression;
  targetStageKey: string;
  description?: string;
}

export interface TransitionSet {
  transitionSetKey: string;
  evaluationMode: 'FIRST_MATCH';
  rules: TransitionRule[];
  defaultTargetStageKey?: string;
}

export interface StageDefinition {
  stageKey: string;
  displayName: string;
  order: number;
  terminal?: boolean;
  formKey?: string;
  queueKey?: string;
  actionKeys: string[];
  bulkActionKeys?: string[];
  slaKey?: string;
  /**
   * Optional override for TRANSITION actions on this stage.
   * When set, Complete uses this set instead of the catalog action’s transitionSetKey.
   */
  transitionSetKey?: string;
  assignmentPolicy: AssignmentPolicy;
  /** Presentation-only canvas position. Does not affect execution order. */
  layout?: { x: number; y: number };
}

export interface WorkflowDefinition {
  initialStageKey: string;
  terminalStageKeys: string[];
  stages: StageDefinition[];
  transitionSets: TransitionSet[];
}

export interface SplunkPolicyConfig {
  mode: string;
  maskStrategy?: string;
  prefixChars?: number;
  suffixChars?: number;
}

export const DEFAULT_SPLUNK_MASK_POLICY: SplunkPolicyConfig = {
  mode: 'MASK',
  maskStrategy: 'KEEP_PREFIX_SUFFIX',
  prefixChars: 1,
  suffixChars: 3
};

export interface FormFieldValidation {
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minDate?: string;
  maxDate?: string;
  minItems?: number;
  maxItems?: number;
}

export type FillFromSource = 'ASSIGNED_TO' | 'TODAY' | 'FIELD';

export interface FormFieldDefinition {
  fieldKey: string;
  path: string;
  component: string;
  label: string;
  helpText?: string;
  width?: number;
  rows?: number;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  validation?: FormFieldValidation;
  piiClassification?: string;
  splunkPolicy?: string | SplunkPolicyConfig;
  /**
   * When the stored path is empty, copy this value into the field.
   * ASSIGNED_TO uses $workflow.assignedTo. TODAY uses the US Eastern calendar date.
   * FIELD copies fillFromFieldKey. Does not overwrite a saved value.
   */
  fillFrom?: FillFromSource;
  fillFromFieldKey?: string;
  /**
   * Read-only display of another form's field on this release.
   * Value is resolved from that field's storage path on case businessData; this field does not own it.
   */
  displayFromFormKey?: string;
  displayFromFieldKey?: string;
}

export interface FormSectionDefinition {
  sectionKey: string;
  title: string;
  layout?: string;
  fields: FormFieldDefinition[];
  repeatable?: boolean;
  path?: string;
  addButtonLabel?: string;
  itemLabel?: string;
  countFieldKey?: string;
  /**
   * When true with countFieldKey, Complete requires the repeating array length
   * to equal the Count field value (for example # of Workloads to Add).
   */
  matchCountField?: boolean;
  choiceSourceFieldKey?: string;
  /** Minimum repeating copies required on Complete (schema minItems). */
  minItems?: number;
  /** Maximum repeating copies allowed on Complete (schema maxItems). */
  maxItems?: number;
  /** When set on a mail repeating section, Complete creates WORKLOAD instances of this definition. */
  spawnDefinitionKey?: string;
  /**
   * Packet field bindings between this mail section (and optional packet-level fields)
   * and the spawned child definition. Authored by field key; paths are resolved at runtime.
   */
  packetFieldBindings?: PacketFieldBinding[];
}

/** How a parent mail field and a child workload field share data. */
export type PacketFieldBindingMode = 'INHERIT_ONCE' | 'PROJECT_CHILD' | 'PROJECT_PARENT';

/**
 * Links a parent field to a child field by stable fieldKey (not JSONPath).
 * parentScope PACKET = field outside the repeating section; ROW = field on each copy.
 */
export interface PacketFieldBinding {
  bindingKey: string;
  parentFieldKey: string;
  childFieldKey: string;
  mode: PacketFieldBindingMode;
  parentScope?: 'PACKET' | 'ROW';
}

export interface FormBehaviorEffect {
  fieldKey: string;
  visible?: boolean;
  required?: boolean;
  readOnly?: boolean;
}

export interface FormBehaviorDefinition {
  behaviorKey: string;
  when: RuleExpression;
  effects: FormBehaviorEffect[];
}

export interface StageFormDefinition {
  formKey: string;
  dataPath: string;
  schemaRef?: string;
  schema?: JsonSchema;
  title: string;
  sections: FormSectionDefinition[];
  behaviors?: FormBehaviorDefinition[];
}

export interface ActionDefinition {
  actionKey: string;
  label: string;
  type: 'TRANSITION' | 'SAVE' | 'RELEASE_ASSIGNMENT' | string;
  requireAssignmentToCurrentUser?: boolean;
  validation?: {
    validateStageForm: boolean;
    schemaRef?: string;
  };
  transitionSetKey?: string;
  assignment?: {
    clearOnTransition: boolean;
  };
  confirmation?: {
    required: boolean;
    message: string;
  };
  audit?: {
    eventType: string;
  };
}

export interface QueueProjectedField {
  fieldKey: string;
  label: string;
  path: string;
}

export interface QueueDefinition {
  queueKey: string;
  displayName: string;
  entityType: EntityType;
  eligibility: Record<string, unknown>;
  defaultSort: Array<{ field: string; direction: 'ASC' | 'DESC' }>;
  columns: string[];
  filters: string[];
  actions: string[];
  pageSize: number;
  /** Form values copied onto the queue row. Display-only; not SQL filters. */
  projectedFields?: QueueProjectedField[];
}

export interface BulkActionDefinition {
  bulkActionKey: string;
  label: string;
  stageKey: string;
  maxSelection: number;
  transactionMode: 'ATOMIC' | 'BEST_EFFORT';
  eligibility?: Record<string, unknown>;
  sharedInputSchema?: JsonSchema;
  writeMappings?: Array<{ source: string; target: string }>;
  transition?: { targetStage: string };
}

export interface ScheduledActionDefinition {
  scheduledActionKey: string;
  trigger: Record<string, unknown>;
  delay: Record<string, unknown>;
  action: Record<string, unknown>;
  cancellation?: Record<string, unknown>;
  retry?: Record<string, unknown>;
}

export interface SlaDefinition {
  slaKey: string;
  clock: 'CALENDAR' | 'BUSINESS';
  target: { durationHours: number };
  warningThresholdPercent: number;
  breachThresholdPercent: number;
  pauseWhen?: { stages: string[] };
  severityOnBreach: string;
}

export interface SearchFieldDefinition {
  fieldKey: string;
  source: 'SYSTEM' | 'BUSINESS_DATA';
  path: string;
  match: 'EXACT_PREFIX' | 'FUZZY' | string;
  pii: boolean;
  /**
   * Indexed field consumers. Omitted flags default to Find-on / Dashboard-off
   * so existing Catalog search configs keep working.
   */
  useInSearch?: boolean;
  useInDashboard?: boolean;
}

export interface SearchDefinition {
  searchKey: string;
  fields: SearchFieldDefinition[];
}

export interface DefinitionRecord {
  id: number;
  definitionKey: string;
  displayName: string;
  entityType: EntityType;
  activeReleaseId: number | null;
  createdAt: Date;
  createdBy: string;
}

export interface ReleaseCatalogItem {
  definitionKey: string;
  displayName: string;
  entityType: EntityType;
  version: string;
  lifecycleStatus: DefinitionLifecycle;
  /** True when this release is `definition.activeReleaseId`. Status stays PUBLISHED. */
  active?: boolean;
}

export interface DefinitionReleaseRecord {
  id: number;
  definitionId: number;
  definitionKey: string;
  displayName: string;
  entityType: EntityType;
  version: string;
  lifecycleStatus: DefinitionLifecycle;
  manifest: Record<string, unknown>;
  canonicalPackage: Record<string, unknown> | null;
  checksumAlgorithm: string | null;
  checksum: string | null;
  createdAt: Date;
  createdBy: string;
  submittedAt: Date | null;
  submittedBy: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  retiredAt: Date | null;
  rowVersion: number;
}

export interface DefinitionRelease {
  id: string;
  definitionKey: string;
  displayName: string;
  entityType: EntityType;
  version: string;
  lifecycleStatus: DefinitionLifecycle;
  schema: JsonSchema;
  workflow: WorkflowDefinition;
  forms: Record<string, StageFormDefinition>;
  actions: Record<string, ActionDefinition>;
  queues: Record<string, QueueDefinition>;
  bulkActions: Record<string, BulkActionDefinition>;
  scheduledActions: Record<string, ScheduledActionDefinition>;
  slas: Record<string, SlaDefinition>;
  search: SearchDefinition;
  checksum?: string;
  submittedBy?: string | null;
  approvedBy?: string | null;
  publishedBy?: string | null;
  rejectedComment?: string | null;
  rowVersion: number;
  /** True when this release is `definition.activeReleaseId`. Status stays PUBLISHED. */
  active?: boolean;
}

export const EMPTY_WORKFLOW: WorkflowDefinition = {
  initialStageKey: '',
  terminalStageKeys: [],
  stages: [],
  transitionSets: []
};

export const EMPTY_SEARCH: SearchDefinition = {
  searchKey: 'DEFAULT',
  fields: []
};
