import type { QueueProjectedField } from '../../configuration/domain/types.js';
import type { CompiledDefinition } from '../../configuration/definitions/compiled-definition.js';
import { isMissing, resolveJsonPath } from '../../../rules/json-path-resolver.js';
import type { WorkflowInstanceRecord } from '../../workflow/domain/types.js';
import type { QueueProjectionRecord } from './types.js';

export function projectInstance(
  instance: WorkflowInstanceRecord,
  compiled: CompiledDefinition
): QueueProjectionRecord {
  const receiptNumber = readReceiptNumber(instance.businessData);
  const projectedJson: Record<string, unknown> = {};
  if (receiptNumber) {
    projectedJson.receiptNumber = receiptNumber;
  }
  for (const field of authoredProjectedFields(compiled)) {
    const value = readProjectedString(instance.businessData, field.path);
    if (value != null) {
      projectedJson[field.fieldKey] = value;
    }
  }
  return {
    workflowInstanceId: instance.id,
    entityType: instance.entityType,
    entityTrackingId: instance.entityTrackingId,
    definitionKey: compiled.definitionKey,
    definitionReleaseId: instance.definitionReleaseId,
    workloadType: compiled.release.displayName,
    currentStageKey: instance.currentStageKey,
    assignedTo: instance.assignedTo,
    branchKey: null,
    locationKey: null,
    priority: null,
    receivedAt: instance.createdAt,
    enteredStageAt: instance.enteredStageAt,
    slaState: null,
    receiptNumber,
    status: instance.status,
    rowVersion: instance.rowVersion,
    projectedJson,
    updatedAt: instance.updatedAt
  };
}

export function authoredProjectedFields(compiled: CompiledDefinition): QueueProjectedField[] {
  const seen = new Set<string>();
  const fields: QueueProjectedField[] = [];
  for (const queue of Object.values(compiled.release.queues ?? {})) {
    for (const field of queue.projectedFields ?? []) {
      if (seen.has(field.fieldKey)) {
        continue;
      }
      seen.add(field.fieldKey);
      fields.push(field);
    }
  }
  // Find a case BUSINESS_DATA fields must be projectable even before a queue column is authored.
  for (const field of compiled.release.search?.fields ?? []) {
    if (field.source !== 'BUSINESS_DATA' || !field.path.trim() || field.path.startsWith('$workflow')) {
      continue;
    }
    if (seen.has(field.fieldKey)) {
      continue;
    }
    seen.add(field.fieldKey);
    fields.push({
      fieldKey: field.fieldKey,
      label: field.fieldKey,
      path: field.path
    });
  }
  return fields;
}

export function readReceiptNumber(data: Record<string, unknown>): string | null {
  if (typeof data.receiptNumber === 'string' && data.receiptNumber) {
    return data.receiptNumber;
  }
  const details = data.dataEntryDetails;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const value = (details as Record<string, unknown>).receiptNumber;
    if (typeof value === 'string' && value) {
      return value;
    }
  }
  return null;
}

function readProjectedString(data: Record<string, unknown>, path: string): string | null {
  try {
    const resolved = resolveJsonPath(path, { businessData: data });
    if (isMissing(resolved) || resolved == null) {
      return null;
    }
    if (typeof resolved === 'string' || typeof resolved === 'number') {
      const text = String(resolved).trim();
      return text || null;
    }
    return null;
  } catch {
    return null;
  }
}

export function ageInQueueMinutes(enteredStageAt: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - enteredStageAt.getTime()) / 60_000));
}

export function formatAgeInQueue(enteredStageAt: Date, now = new Date()): string {
  const minutes = ageInQueueMinutes(enteredStageAt, now);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}
