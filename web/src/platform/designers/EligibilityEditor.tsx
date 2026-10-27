import type { QueueEligibilitySource } from '../../../../src/modules/queue/domain/eligibility.js';

const OPERATORS = [
  'EQUALS',
  'NOT_EQUALS',
  'IN',
  'NOT_IN',
  'IS_NULL',
  'NOT_NULL',
  'EXISTS',
  'NOT_EXISTS',
  'TRUE',
  'FALSE'
] as const;

export const ELIGIBILITY_FIELDS: Array<{ source: QueueEligibilitySource; field: string; label: string }> = [
  { source: 'workflow', field: 'currentStageKey', label: 'Stage (currentStageKey)' },
  { source: 'workflow', field: 'assignedTo', label: 'Assigned to' },
  { source: 'workflow', field: 'entityType', label: 'Entity type' },
  { source: 'workflow', field: 'definitionKey', label: 'Definition' },
  { source: 'workflow', field: 'status', label: 'Status' },
  { source: 'workflow', field: 'entityTrackingId', label: 'Tracking ID' },
  { source: 'business', field: 'receiptNumber', label: 'Receipt number' },
  { source: 'business', field: 'workloadType', label: 'Workload type' },
  { source: 'system', field: 'slaState', label: 'SLA state' },
  { source: 'system', field: 'branchKey', label: 'Branch' },
  { source: 'system', field: 'locationKey', label: 'Location' },
  { source: 'system', field: 'priority', label: 'Priority' },
  { source: 'system', field: 'receivedAt', label: 'Received at' }
];

export type EligibilityNode =
  | { all: EligibilityNode[] }
  | { any: EligibilityNode[] }
  | { not: EligibilityNode }
  | { source: QueueEligibilitySource; field: string; operator: string; value?: unknown };

export function blankEligibilityPredicate(value = ''): EligibilityNode {
  return { source: 'workflow', field: 'currentStageKey', operator: 'EQUALS', value };
}

export function EligibilityEditor({
  value,
  onChange,
  readOnly,
  label = 'Eligibility'
}: {
  value: EligibilityNode;
  onChange: (next: EligibilityNode) => void;
  readOnly?: boolean;
  label?: string;
}) {
  const kind = nodeKind(value);
  return (
    <fieldset className="optic-rule-editor">
      <legend>{label}</legend>
      <label>
        {label} group
        <select value={kind} disabled={readOnly} onChange={(event) => onChange(toKind(event.target.value))}>
          <option value="predicate">Predicate</option>
          <option value="all">all</option>
          <option value="any">any</option>
          <option value="not">not</option>
        </select>
      </label>
      {kind === 'predicate' && 'source' in value ? (
        <div className="optic-designer-behavior">
          <label>
            {label} field
            <select
              value={`${value.source}.${value.field}`}
              disabled={readOnly}
              onChange={(event) => {
                const selected = ELIGIBILITY_FIELDS.find((item) => `${item.source}.${item.field}` === event.target.value);
                if (!selected) {
                  return;
                }
                onChange({ ...value, source: selected.source, field: selected.field });
              }}
            >
              {ELIGIBILITY_FIELDS.map((item) => (
                <option key={`${item.source}.${item.field}`} value={`${item.source}.${item.field}`}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {label} operator
            <select
              value={value.operator}
              disabled={readOnly}
              onChange={(event) => onChange({ ...value, operator: event.target.value })}
            >
              {OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {operator}
                </option>
              ))}
            </select>
          </label>
          <label>
            {label} value
            <input
              value={formatValue(value.value)}
              disabled={readOnly}
              onChange={(event) => onChange({ ...value, value: parseValue(event.target.value) })}
            />
          </label>
        </div>
      ) : null}
      {kind === 'all' && 'all' in value
        ? value.all.map((child, index) => (
            <div key={`all-${index}`} className="optic-rule-child">
              <EligibilityEditor
                label={`all[${index}]`}
                value={child}
                readOnly={readOnly}
                onChange={(next) => onChange({ all: value.all.map((item, itemIndex) => (itemIndex === index ? next : item)) })}
              />
              <button
                type="button"
                disabled={readOnly || value.all.length <= 1}
                aria-label={`Remove condition all[${index}]`}
                onClick={() => onChange({ all: value.all.filter((_, itemIndex) => itemIndex !== index) })}
              >
                Remove condition
              </button>
            </div>
          ))
        : null}
      {kind === 'any' && 'any' in value
        ? value.any.map((child, index) => (
            <div key={`any-${index}`} className="optic-rule-child">
              <EligibilityEditor
                label={`any[${index}]`}
                value={child}
                readOnly={readOnly}
                onChange={(next) => onChange({ any: value.any.map((item, itemIndex) => (itemIndex === index ? next : item)) })}
              />
              <button
                type="button"
                disabled={readOnly || value.any.length <= 1}
                aria-label={`Remove condition any[${index}]`}
                onClick={() => onChange({ any: value.any.filter((_, itemIndex) => itemIndex !== index) })}
              >
                Remove condition
              </button>
            </div>
          ))
        : null}
      {kind === 'not' && 'not' in value ? (
        <EligibilityEditor label="not" value={value.not} readOnly={readOnly} onChange={(next) => onChange({ not: next })} />
      ) : null}
      {kind === 'all' || kind === 'any' ? (
        <button
          type="button"
          disabled={readOnly}
          onClick={() =>
            onChange(
              kind === 'all'
                ? { all: [...(('all' in value ? value.all : []) as EligibilityNode[]), blankEligibilityPredicate()] }
                : { any: [...(('any' in value ? value.any : []) as EligibilityNode[]), blankEligibilityPredicate()] }
            )
          }
        >
          Add condition to {label}
        </button>
      ) : null}
    </fieldset>
  );
}

function nodeKind(value: EligibilityNode): 'all' | 'any' | 'not' | 'predicate' {
  if ('all' in value) {
    return 'all';
  }
  if ('any' in value) {
    return 'any';
  }
  if ('not' in value) {
    return 'not';
  }
  return 'predicate';
}

function toKind(kind: string): EligibilityNode {
  if (kind === 'all') {
    return { all: [blankEligibilityPredicate()] };
  }
  if (kind === 'any') {
    return { any: [blankEligibilityPredicate()] };
  }
  if (kind === 'not') {
    return { not: blankEligibilityPredicate() };
  }
  return blankEligibilityPredicate();
}

function formatValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}
