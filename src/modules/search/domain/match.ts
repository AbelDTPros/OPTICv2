import type { SearchFieldDefinition } from '../../configuration/domain/types.js';
import type { QueueProjectionRecord } from '../../queue/domain/types.js';
import { MISSING, resolveJsonPath } from '../../../rules/json-path-resolver.js';

const DEFAULT_FIELDS: SearchFieldDefinition[] = [
  { fieldKey: 'trackingId', source: 'SYSTEM', path: '$workflow.trackingId', match: 'CONTAINS', pii: false },
  { fieldKey: 'receiptNumber', source: 'SYSTEM', path: '$workflow.receiptNumber', match: 'EXACT_PREFIX', pii: true },
  { fieldKey: 'currentStageKey', source: 'SYSTEM', path: '$workflow.currentStageKey', match: 'EXACT_PREFIX', pii: false },
  { fieldKey: 'assignedTo', source: 'SYSTEM', path: '$workflow.assignedTo', match: 'EXACT_PREFIX', pii: false }
];

export function searchableFields(configured: SearchFieldDefinition[] | undefined): SearchFieldDefinition[] {
  const fields = configured && configured.length > 0 ? configured : DEFAULT_FIELDS;
  const keys = new Set(fields.map((field) => field.fieldKey));
  return [
    ...fields,
    ...DEFAULT_FIELDS.filter((field) => !keys.has(field.fieldKey))
  ];
}

export function matchProjection(
  row: QueueProjectionRecord,
  fields: SearchFieldDefinition[],
  needles: {
    trackingId?: string;
    receiptNumber?: string;
    extras?: Record<string, string>;
  },
  businessData?: Record<string, unknown> | null
): Array<{ fieldKey: string; value: string; pii: boolean }> {
  const trackingNeedle = needles.trackingId?.trim() ?? '';
  const receiptNeedle = needles.receiptNumber?.trim() ?? '';
  const extraNeedles = Object.entries(needles.extras ?? {}).filter(([, value]) => value.trim());
  if (!trackingNeedle && !receiptNeedle && extraNeedles.length === 0) {
    return displayFields(row, fields, businessData);
  }
  const hits: Array<{ fieldKey: string; value: string; pii: boolean }> = [];
  if (trackingNeedle) {
    // Always match the system tracking id. Projected/business copies (for example
    // form $.trackingId) must not shadow Find a case.
    const field = fields.find((item) => item.fieldKey === 'trackingId') ?? DEFAULT_FIELDS[0]!;
    const value = row.entityTrackingId;
    if (!value || !matches(value, trackingNeedle, 'CONTAINS')) {
      return [];
    }
    hits.push({ fieldKey: 'trackingId', value, pii: field.pii });
  }
  if (receiptNeedle) {
    const field = fields.find((item) => item.fieldKey === 'receiptNumber') ?? DEFAULT_FIELDS[1]!;
    const value = fieldValue(row, field, businessData);
    if (!value || !matches(value, receiptNeedle, field.match)) {
      return [];
    }
    hits.push({ fieldKey: 'receiptNumber', value, pii: field.pii });
  }
  for (const [fieldKey, rawNeedle] of extraNeedles) {
    const needle = rawNeedle.trim();
    const field = fields.find((item) => item.fieldKey === fieldKey);
    if (!field) {
      return [];
    }
    const value = fieldValue(row, field, businessData);
    if (!value || !matches(value, needle, normalizeMatchMode(field.match))) {
      return [];
    }
    hits.push({ fieldKey, value, pii: field.pii });
  }
  return hits;
}

function displayFields(
  row: QueueProjectionRecord,
  fields: SearchFieldDefinition[],
  businessData?: Record<string, unknown> | null
): Array<{ fieldKey: string; value: string; pii: boolean }> {
  return fields
    .map((field) => {
      const value = fieldValue(row, field, businessData);
      return value ? { fieldKey: field.fieldKey, value, pii: field.pii } : null;
    })
    .filter((item): item is { fieldKey: string; value: string; pii: boolean } => Boolean(item))
    .slice(0, 6);
}

function fieldValue(
  row: QueueProjectionRecord,
  field: SearchFieldDefinition,
  businessData?: Record<string, unknown> | null
): string | null {
  const projected = projectedFieldValue(row, field);
  if (projected) {
    return projected;
  }
  if (field.source === 'SYSTEM' || field.path.startsWith('$workflow')) {
    const system = systemValue(row, field);
    if (system) {
      return system;
    }
  }
  const businessRoot = {
    ...(row.projectedJson ?? {}),
    ...(businessData ?? {}),
    trackingId: row.entityTrackingId,
    receiptNumber: row.receiptNumber,
    ANumber:
      (businessData as { ANumber?: unknown } | null | undefined)?.ANumber ?? row.projectedJson?.ANumber
  };
  const workflowRoot = {
    trackingId: row.entityTrackingId,
    receiptNumber: row.receiptNumber,
    currentStageKey: row.currentStageKey,
    assignedTo: row.assignedTo,
    definitionKey: row.definitionKey,
    slaState: row.slaState,
    ...(row.projectedJson ?? {})
  };
  try {
    const resolved = resolveJsonPath(field.path, {
      businessData: businessRoot,
      workflow: workflowRoot
    });
    if (resolved !== MISSING && resolved != null) {
      return String(resolved);
    }
  } catch {
    // fall through to alternate paths
  }
  // Authors sometimes point BUSINESS_DATA at $workflow.X; try $.X on business/projected JSON.
  if (field.path.startsWith('$workflow.')) {
    try {
      const asBusiness = resolveJsonPath(`$.${field.path.slice('$workflow.'.length)}`, {
        businessData: businessRoot,
        workflow: workflowRoot
      });
      if (asBusiness !== MISSING && asBusiness != null) {
        return String(asBusiness);
      }
    } catch {
      // ignore
    }
  }
  return systemValue(row, field);
}

/** Prefer flat projected keys (fieldKey or path leaf), which is how queue projection stores values. */
function projectedFieldValue(
  row: QueueProjectionRecord,
  field: SearchFieldDefinition
): string | null {
  const json = row.projectedJson ?? {};
  for (const key of [field.fieldKey, pathLeaf(field.path)]) {
    if (!key) {
      continue;
    }
    const value = json[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) {
        return text;
      }
    }
  }
  return null;
}

function pathLeaf(path: string): string | null {
  const cleaned = path.replace(/^\$workflow\.?/, '').replace(/^\$\.?/, '');
  if (!cleaned) {
    return null;
  }
  const parts = cleaned.split('.').filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function systemValue(row: QueueProjectionRecord, field: SearchFieldDefinition): string | null {
  const key = field.fieldKey.toLowerCase();
  if (key === 'trackingid' || field.path.endsWith('trackingId')) {
    return row.entityTrackingId;
  }
  if (key === 'receiptnumber' || field.path.toLowerCase().includes('receipt')) {
    return row.receiptNumber;
  }
  if (key === 'currentstagekey' || field.path.includes('currentStageKey')) {
    return row.currentStageKey;
  }
  if (key === 'assignedto' || field.path.includes('assignedTo')) {
    return row.assignedTo;
  }
  if (key === 'definitionkey') {
    return row.definitionKey;
  }
  if (key === 'slastate') {
    return row.slaState;
  }
  return projectedFieldValue(row, field);
}

/** FUZZY is a legacy alias for CONTAINS. */
export function normalizeMatchMode(match: string): string {
  if (match === 'FUZZY') {
    return 'CONTAINS';
  }
  if (match === 'EXACT') {
    return 'EQUALS';
  }
  return match;
}

function matches(value: string, needle: string, match: string): boolean {
  const left = value.toLowerCase();
  const right = needle.toLowerCase();
  const mode = normalizeMatchMode(match);
  if (mode === 'EQUALS') {
    return left === right;
  }
  if (mode === 'CONTAINS') {
    return left.includes(right);
  }
  return left.startsWith(right);
}
