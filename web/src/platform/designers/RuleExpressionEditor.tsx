import { useRef, useState } from 'react';
import type { RuleExpression, RuleOperator } from '../../../../src/modules/configuration/domain/types.js';
import { groupRulePathOptions, type RulePathOption } from './workflow-model.js';

const OPERATORS: RuleOperator[] = [
  'EQUALS',
  'NOT_EQUALS',
  'GREATER_THAN',
  'LESS_THAN',
  'IN',
  'EXISTS',
  'IS_NULL',
  'CONTAINS',
  'TRUE',
  'FALSE'
];

const COMPARISON_OPERATORS = new Set([
  'EQUALS',
  'NOT_EQUALS',
  'GREATER_THAN',
  'LESS_THAN',
  'GTE',
  'LTE'
]);

/**
 * Top-level When editor: Group stays visible; nested conditions are compact
 * one-liners that expand down to leaf predicates.
 */
export function RuleExpressionEditor({
  value,
  onChange,
  readOnly,
  label = 'When',
  pathOptions
}: {
  value: RuleExpression;
  onChange: (next: RuleExpression) => void;
  readOnly?: boolean;
  label?: string;
  pathOptions?: RulePathOption[];
}) {
  const kind = expressionKind(value);
  const pendingExpandRef = useRef<number | null>(null);

  function addGroupedCondition() {
    if (kind === 'all' && 'all' in value) {
      pendingExpandRef.current = value.all.length;
      onChange({ all: [...value.all, emptyPredicate(firstFormPath(pathOptions))] });
      return;
    }
    if (kind === 'any' && 'any' in value) {
      pendingExpandRef.current = value.any.length;
      onChange({ any: [...value.any, emptyPredicate(firstFormPath(pathOptions))] });
    }
  }

  return (
    <fieldset className="optic-rule-editor">
      <legend>{label}</legend>
      <GroupSelect
        kind={kind}
        readOnly={readOnly}
        onChange={(nextKind) => onChange(toKind(nextKind, firstFormPath(pathOptions)))}
      />
      {kind === 'predicate' && 'path' in value ? (
        <PredicateFields value={value} readOnly={readOnly} pathOptions={pathOptions} onChange={onChange} />
      ) : null}
      {kind === 'all' && 'all' in value
        ? value.all.map((child, index) => (
            <NestedCondition
              key={`all-${index}`}
              label={`Condition ${index + 1}`}
              value={child}
              readOnly={readOnly}
              pathOptions={pathOptions}
              defaultExpanded={pendingExpandRef.current === index}
              canRemove={value.all.length > 1}
              onChange={(next) => onChange({ all: value.all.map((item, itemIndex) => (itemIndex === index ? next : item)) })}
              onRemove={() => onChange({ all: value.all.filter((_, itemIndex) => itemIndex !== index) })}
            />
          ))
        : null}
      {kind === 'any' && 'any' in value
        ? value.any.map((child, index) => (
            <NestedCondition
              key={`any-${index}`}
              label={`Condition ${index + 1}`}
              value={child}
              readOnly={readOnly}
              pathOptions={pathOptions}
              defaultExpanded={pendingExpandRef.current === index}
              canRemove={value.any.length > 1}
              onChange={(next) => onChange({ any: value.any.map((item, itemIndex) => (itemIndex === index ? next : item)) })}
              onRemove={() => onChange({ any: value.any.filter((_, itemIndex) => itemIndex !== index) })}
            />
          ))
        : null}
      {kind === 'not' && 'not' in value ? (
        <NestedCondition
          label="not"
          value={value.not}
          readOnly={readOnly}
          pathOptions={pathOptions}
          defaultExpanded
          canRemove={false}
          onChange={(next) => onChange({ not: next })}
        />
      ) : null}
      {kind === 'all' || kind === 'any' ? (
        <button type="button" disabled={readOnly} onClick={addGroupedCondition}>
          Add condition
        </button>
      ) : null}
    </fieldset>
  );
}

function NestedCondition({
  label,
  value,
  onChange,
  readOnly,
  pathOptions,
  defaultExpanded = false,
  canRemove,
  onRemove
}: {
  label: string;
  value: RuleExpression;
  onChange: (next: RuleExpression) => void;
  readOnly?: boolean;
  pathOptions?: RulePathOption[];
  defaultExpanded?: boolean;
  canRemove: boolean;
  onRemove?: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const pendingExpandRef = useRef<number | null>(null);
  const kind = expressionKind(value);
  const summary = summarizeRuleExpression(value);

  function addGroupedCondition() {
    if (kind === 'all' && 'all' in value) {
      pendingExpandRef.current = value.all.length;
      onChange({ all: [...value.all, emptyPredicate(firstFormPath(pathOptions))] });
      return;
    }
    if (kind === 'any' && 'any' in value) {
      pendingExpandRef.current = value.any.length;
      onChange({ any: [...value.any, emptyPredicate(firstFormPath(pathOptions))] });
    }
  }

  return (
    <div
      role="group"
      aria-label={label}
      className="optic-rule-node"
      data-expanded={expanded ? 'true' : undefined}
    >
      <div className="optic-rule-node-summary">
        <button
          type="button"
          className="optic-rule-node-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}: ${summary}`}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="optic-rule-node-title">{label}</span>
          <span className="optic-rule-node-preview">{summary}</span>
        </button>
        {onRemove ? (
          <button
            type="button"
            className="optic-designer-quiet-button"
            disabled={readOnly || !canRemove}
            aria-label={`Remove ${label.toLowerCase()}`}
            title="Remove condition"
            onClick={onRemove}
          >
            Remove
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="optic-rule-node-body">
          <GroupSelect
            kind={kind}
            readOnly={readOnly}
            onChange={(nextKind) => onChange(toKind(nextKind, firstFormPath(pathOptions)))}
          />
          {kind === 'predicate' && 'path' in value ? (
            <PredicateFields value={value} readOnly={readOnly} pathOptions={pathOptions} onChange={onChange} />
          ) : null}
          {kind === 'all' && 'all' in value
            ? value.all.map((child, index) => (
                <NestedCondition
                  key={`all-${index}`}
                  label={`Condition ${index + 1}`}
                  value={child}
                  readOnly={readOnly}
                  pathOptions={pathOptions}
                  defaultExpanded={pendingExpandRef.current === index}
                  canRemove={value.all.length > 1}
                  onChange={(next) =>
                    onChange({ all: value.all.map((item, itemIndex) => (itemIndex === index ? next : item)) })
                  }
                  onRemove={() => onChange({ all: value.all.filter((_, itemIndex) => itemIndex !== index) })}
                />
              ))
            : null}
          {kind === 'any' && 'any' in value
            ? value.any.map((child, index) => (
                <NestedCondition
                  key={`any-${index}`}
                  label={`Condition ${index + 1}`}
                  value={child}
                  readOnly={readOnly}
                  pathOptions={pathOptions}
                  defaultExpanded={pendingExpandRef.current === index}
                  canRemove={value.any.length > 1}
                  onChange={(next) =>
                    onChange({ any: value.any.map((item, itemIndex) => (itemIndex === index ? next : item)) })
                  }
                  onRemove={() => onChange({ any: value.any.filter((_, itemIndex) => itemIndex !== index) })}
                />
              ))
            : null}
          {kind === 'not' && 'not' in value ? (
            <NestedCondition
              label="not"
              value={value.not}
              readOnly={readOnly}
              pathOptions={pathOptions}
              defaultExpanded
              canRemove={false}
              onChange={(next) => onChange({ not: next })}
            />
          ) : null}
          {kind === 'all' || kind === 'any' ? (
            <button type="button" disabled={readOnly} onClick={addGroupedCondition}>
              Add condition
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GroupSelect({
  kind,
  readOnly,
  onChange
}: {
  kind: 'all' | 'any' | 'not' | 'predicate';
  readOnly?: boolean;
  onChange: (kind: string) => void;
}) {
  return (
    <label>
      Group
      <select value={kind} disabled={readOnly} onChange={(event) => onChange(event.target.value)}>
        <option value="predicate">Predicate</option>
        <option value="all">all</option>
        <option value="any">any</option>
        <option value="not">not</option>
      </select>
    </label>
  );
}

function PredicateFields({
  value,
  readOnly,
  pathOptions,
  onChange
}: {
  value: Extract<RuleExpression, { path: string }>;
  readOnly?: boolean;
  pathOptions?: RulePathOption[];
  onChange: (next: RuleExpression) => void;
}) {
  return (
    <div className="optic-designer-behavior">
      <PathField
        path={value.path}
        readOnly={readOnly}
        pathOptions={pathOptions}
        onChange={(path) => onChange({ ...value, path })}
      />
      <label>
        Operator
        <select
          value={value.operator}
          disabled={readOnly}
          onChange={(event) => onChange({ ...value, operator: event.target.value as RuleOperator })}
        >
          {OPERATORS.map((operator) => (
            <option key={operator} value={operator}>
              {operator}
            </option>
          ))}
          {!OPERATORS.includes(value.operator) ? (
            <option value={value.operator}>{value.operator}</option>
          ) : null}
        </select>
      </label>
      <ValueField
        value={value.value}
        operator={value.operator}
        path={value.path}
        readOnly={readOnly}
        pathOptions={pathOptions}
        onChange={(nextValue) => onChange({ ...value, value: nextValue })}
      />
    </div>
  );
}

export function emptyPredicate(path = '$.field'): RuleExpression {
  return { path, operator: 'EQUALS', value: '' };
}

/** One-line summary for collapsed rule/condition rows. */
export function summarizeRuleExpression(when: RuleExpression): string {
  if ('all' in when) {
    if (when.all.length === 0) {
      return 'all (empty)';
    }
    if (when.all.length === 1) {
      return summarizeRuleExpression(when.all[0]!);
    }
    return `all (${when.all.length} conditions)`;
  }
  if ('any' in when) {
    if (when.any.length === 0) {
      return 'any (empty)';
    }
    if (when.any.length === 1) {
      return summarizeRuleExpression(when.any[0]!);
    }
    return `any (${when.any.length} conditions)`;
  }
  if ('not' in when) {
    return `not (${summarizeRuleExpression(when.not)})`;
  }
  const path = when.path?.trim() || 'path';
  const shortPath = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : path;
  if (when.operator === 'EXISTS' || when.operator === 'IS_NULL' || when.operator === 'TRUE' || when.operator === 'FALSE') {
    return `${shortPath} ${when.operator}`;
  }
  const raw = when.value;
  const valueText =
    raw === undefined || raw === null
      ? '…'
      : typeof raw === 'string'
        ? raw.trim() || '…'
        : Array.isArray(raw)
          ? raw.join(', ')
          : String(raw);
  return `${shortPath} ${when.operator} ${valueText}`;
}

function firstFormPath(pathOptions?: RulePathOption[]): string | undefined {
  return pathOptions?.find((item) => item.value.startsWith('$.'))?.value;
}

function PathField({
  path,
  readOnly,
  pathOptions,
  onChange
}: {
  path: string;
  readOnly?: boolean;
  pathOptions?: RulePathOption[];
  onChange: (path: string) => void;
}) {
  if (!pathOptions || pathOptions.length === 0) {
    return (
      <label>
        Path
        <input value={path} disabled={readOnly} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }
  const known = pathOptions.some((item) => item.value === path);
  const groups = groupRulePathOptions(pathOptions);
  return (
    <label>
      Path
      <select value={path} disabled={readOnly} onChange={(event) => onChange(event.target.value)}>
        {known ? null : (
          <option value={path}>
            {path} (not on a form)
          </option>
        )}
        {groups.map(({ group, items }) => (
          <optgroup key={group} label={group}>
            {items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function ValueField({
  value,
  operator,
  path,
  readOnly,
  pathOptions,
  onChange
}: {
  value: unknown;
  operator: string;
  path: string;
  readOnly?: boolean;
  pathOptions?: RulePathOption[];
  onChange: (next: unknown) => void;
}) {
  const pathMeta = pathOptions?.find((item) => item.value === path);
  const choices =
    operator === 'EQUALS' || operator === 'NOT_EQUALS' ? pathMeta?.choices : undefined;
  if (choices && choices.length > 0) {
    const current = formatRuleValue(value);
    const known = choices.some((item) => item.value === current);
    return (
      <label>
        Value
        <select value={current} disabled={readOnly} onChange={(event) => onChange(parseRuleValue(event.target.value))}>
          {known ? null : <option value={current}>{current || 'Select…'}</option>}
          {choices.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const compareToFields =
    COMPARISON_OPERATORS.has(operator) && pathOptions
      ? pathOptions.filter((item) => item.value !== path && item.value.startsWith('$.'))
      : [];
  const current = formatRuleValue(value);
  const comparesToField = compareToFields.some((item) => item.value === current);
  const dateValue =
    pathMeta?.valueKind === 'date' ||
    compareToFields.find((item) => item.value === current)?.valueKind === 'date';

  return (
    <>
      {compareToFields.length > 0 ? (
        <label>
          Compare to field
          <select
            value={comparesToField ? current : ''}
            disabled={readOnly}
            onChange={(event) => onChange(event.target.value ? event.target.value : '')}
          >
            <option value="">Literal value…</option>
            {groupRulePathOptions(compareToFields).map(({ group, items }) => (
              <optgroup key={group} label={group}>
                {items.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : null}
      {comparesToField ? null : (
        <label>
          Value
          <input
            type={dateValue || (pathMeta?.valueKind === 'date' && COMPARISON_OPERATORS.has(operator)) ? 'date' : 'text'}
            value={current}
            disabled={readOnly}
            onChange={(event) => onChange(parseRuleValue(event.target.value))}
          />
        </label>
      )}
    </>
  );
}

function expressionKind(value: RuleExpression): 'all' | 'any' | 'not' | 'predicate' {
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

function toKind(kind: string, path?: string): RuleExpression {
  if (kind === 'all') {
    return { all: [emptyPredicate(path)] };
  }
  if (kind === 'any') {
    return { any: [emptyPredicate(path)] };
  }
  if (kind === 'not') {
    return { not: emptyPredicate(path) };
  }
  return emptyPredicate(path);
}

function formatRuleValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function parseRuleValue(raw: string): unknown {
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
