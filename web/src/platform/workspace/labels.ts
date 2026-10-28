import { buildScanPayload } from '../../../../src/modules/tracking/domain/scan-payload.js';
import { getAtPath } from '../../../../src/modules/workflow/domain/merge-patch.js';
import { kindKeyFromDefinition, kindLabel } from './kind-catalog.js';
import type { WorkflowSummary } from '../designers/workflow-api.js';

export interface CaseLabel {
  entityType: string;
  trackingId: string;
  kindLabel: string;
  /**
   * Business status value for workloads only (not instance ACTIVE/COMPLETED).
   * Shown without a field caption — e.g. Accepted / Rejected.
   */
  statusText?: string;
  payload: string;
}

export function labelForSummary(summary: WorkflowSummary): CaseLabel {
  const workload = summary.entityType === 'WORKLOAD';
  return {
    entityType: summary.entityType,
    trackingId: summary.trackingId,
    kindLabel: kindLabel(kindKeyFromDefinition(summary.definition.definitionKey)),
    ...(workload ? { statusText: workloadStatusText(summary.businessData) } : {}),
    payload: buildScanPayload(summary.entityType, summary.trackingId)
  };
}

/** Business workload status for stickers — not instance ACTIVE/COMPLETED. */
export function workloadStatusText(businessData: unknown): string {
  for (const path of ['$.workload.workloadStatus', '$.dataEntryDetails.workloadStatus']) {
    const value = getAtPath(businessData, path);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return findStringField(businessData, 'workloadStatus') ?? '';
}

function findStringField(data: unknown, field: string): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findStringField(item, field);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const direct = record[field];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  for (const value of Object.values(record)) {
    const found = findStringField(value, field);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function labelsForPacket(working: WorkflowSummary): CaseLabel[] {
  const seen = new Set<string>();
  const labels: CaseLabel[] = [];
  for (const summary of [
    working,
    working.packet?.parent,
    ...(working.packet?.children ?? [])
  ]) {
    if (!summary) {
      continue;
    }
    const key = `${summary.entityType}:${summary.trackingId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    labels.push(labelForSummary(summary));
  }
  return labels;
}

export function printLabels(labels: CaseLabel[], qrByPayload: Record<string, string>): void {
  // Do not pass noopener here: browsers then return null from window.open, so print
  // silently no-ops. Clear opener after we finish writing the document instead.
  const frame = window.open('', '_blank', 'width=720,height=640');
  if (!frame) {
    throw new Error(
      'Print labels needs a pop-up window. Allow pop-ups for this site, then try Print again.'
    );
  }
  const stickers = labels
    .map((label) => {
      const qr = qrByPayload[label.payload] ?? '';
      const status =
        label.statusText?.trim()
          ? `<p class="status">${escapeHtml(label.statusText.trim())}</p>`
          : '';
      return `<article class="sticker">
        <div class="qr">${qr}</div>
        <div class="copy">
          <p class="kind">${escapeHtml(label.kindLabel)} · ${escapeHtml(label.entityType)}</p>
          <p class="tracking">${escapeHtml(label.trackingId)}</p>
          ${status}
        </div>
      </article>`;
    })
    .join('');
  frame.document.write(`<!doctype html><html lang="en"><head><title>OPTIC labels</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; color: #102a43; margin: 1rem; }
      h1 { font-size: 1rem; }
      .sheet { display: flex; flex-wrap: wrap; gap: 0.75rem; }
      .sticker { border: 2px solid #102a43; width: 3.4in; min-height: 1.5in; padding: 0.45rem; display: flex; gap: 0.6rem; page-break-inside: avoid; }
      .qr svg { width: 112px; height: 112px; display: block; }
      .kind, .status { margin: 0 0 0.2rem; font-size: 0.85rem; }
      .tracking { margin: 0 0 0.35rem; font-size: 1.05rem; font-weight: 750; word-break: break-all; }
      @media print { body { margin: 0; } button { display: none; } }
    </style></head><body>
    <h1>Print these stickers and put them on the mail item and each application.</h1>
    <p>Each sticker shows the tracking number as text. Workload stickers also show Accepted, Rejected, or similar status when set. The QR opens the same case when scanned.</p>
    <div class="sheet">${stickers}</div>
    </body></html>`);
  frame.document.close();
  frame.opener = null;
  frame.focus();
  frame.print();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
