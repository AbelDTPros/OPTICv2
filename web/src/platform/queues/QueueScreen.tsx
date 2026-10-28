import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { officerDisplayName } from '../actors/demo-officers.js';
import type { DisplayError } from '../api/apply-api-error.js';
import { TrackingIdLinkWithCopy } from '../tracking/TrackingIdDisplay.js';
import { CaughtErrorBanner } from '../ui/CaughtErrorBanner.js';
import { ButtonLabel, Icon } from '../ui/Icon.js';
import { PagerControls } from '../ui/PagerControls.js';
import { formatSlaStateLabel, slaStateTone } from '../ui/sla-label.js';
import type { DemoBulkAction, DemoBulkResult, DemoQueuePage, DemoQueueRow } from './demo-queue.js';
import { ReassignDialog } from './ReassignDialog.js';

export interface QueueScreenProps {
  queue: DemoQueuePage;
  actorId?: string;
  errorSummary?: DisplayError;
  loading?: boolean;
  bulkResult?: DemoBulkResult;
  emptyHint?: string;
  onFindCase?: () => void;
  onPageChange?: (page: number) => void;
  onSortChange?: (field: string, direction: 'ASC' | 'DESC') => void;
  onFilterChange?: (key: string, value: string) => void;
  onAssign?: (row: DemoQueueRow) => void;
  onOpen?: (row: DemoQueueRow) => void;
  onRelease?: (row: DemoQueueRow) => void;
  onReassign?: (row: DemoQueueRow, assignedTo: string) => void;
  onBulkExecute?: (action: DemoBulkAction, rows: DemoQueueRow[], input: Record<string, string>) => void;
  headingLevel?: 1 | 2;
  openTrackingId?: string;
}

export function QueueScreen({
  queue,
  actorId,
  errorSummary,
  loading,
  bulkResult,
  emptyHint,
  onFindCase,
  onPageChange,
  onSortChange,
  onFilterChange,
  onAssign,
  onOpen,
  onRelease,
  onReassign,
  onBulkExecute,
  headingLevel = 1,
  openTrackingId
}: QueueScreenProps) {
  const totalPages = Math.max(1, Math.ceil(queue.total / queue.pageSize));
  const currentSort = queue.sort[0];
  const canAssign = queue.actions.some((action) => action.actionKey === 'ASSIGN_TO_SELF');
  const canRelease = queue.actions.some((action) => action.actionKey === 'RELEASE_TO_QUEUE');
  const bulkActions = queue.bulkActions ?? [];
  const canBulk = bulkActions.length > 0;
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkInput, setBulkInput] = useState<Record<string, string>>({});
  const [reassigning, setReassigning] = useState<DemoQueueRow | undefined>();
  const rowIds = useMemo(() => queue.rows.map((row) => row.trackingId), [queue.rows]);

  useEffect(() => {
    setSelected((current) => current.filter((id) => rowIds.includes(id)));
  }, [rowIds]);

  const selectedRows = queue.rows.filter((row) => selected.includes(row.trackingId));
  const allSelected = queue.rows.length > 0 && selectedRows.length === queue.rows.length;
  const hasRowActions = canAssign || canRelease || Boolean(onReassign) || Boolean(onOpen);
  const rowOpens = Boolean(onOpen);
  const extraColumns = 1 + (hasRowActions ? 1 : 0) + (canBulk ? 1 : 0);
  const headingId = headingLevel === 1 ? 'queue-heading' : `queue-${queue.queueKey}-heading`;
  const TitleTag = headingLevel === 1 ? 'h1' : 'h2';
  const activeFilterChips = useMemo(() => {
    return queue.filters
      .map((filter) => {
        const raw = (queue.appliedFilters[filter.key] ?? '').trim();
        if (!raw) {
          return null;
        }
        return {
          key: filter.key,
          label: filter.label,
          valueLabel: filterValueLabel(filter.key, raw)
        };
      })
      .filter((chip): chip is { key: string; label: string; valueLabel: string } => chip != null);
  }, [queue.appliedFilters, queue.filters]);

  return (
    <section className="optic-queue" aria-labelledby={headingId}>
      <header className="optic-queue-header">
        <div>
          <TitleTag id={headingId}>{queue.displayName}</TitleTag>
          <p className="optic-form-key">{queue.queueKey}</p>
        </div>
        <p className="optic-queue-count" aria-live="polite">
          <span className="optic-count-badge">{queue.total}</span>
          {queue.total === 1 ? 'item' : 'items'}
        </p>
      </header>

      <CaughtErrorBanner error={errorSummary} />
      {loading ? (
        <p className="optic-help" role="status" aria-live="polite">
          Loading queue…
        </p>
      ) : null}

      {/* Always reserve filter chrome height so switching queues does not jump the table. */}
      <form
        className={`optic-queue-filters${queue.filters.length === 0 ? ' optic-queue-filters--empty' : ''}`}
        onSubmit={(event) => event.preventDefault()}
        aria-hidden={queue.filters.length === 0 ? true : undefined}
      >
        <fieldset disabled={queue.filters.length === 0}>
          <legend>Filters</legend>
          <div className="optic-queue-filter-row">
            {queue.filters.length > 0 ? (
              queue.filters.map((filter) => (
                <div className="optic-field" key={filter.key}>
                  <label htmlFor={`queue-filter-${filter.key}`}>{filter.label}</label>
                  {filter.key === 'assignedStatus' ? (
                    <select
                      id={`queue-filter-${filter.key}`}
                      value={queue.appliedFilters[filter.key] ?? ''}
                      onChange={(event) => onFilterChange?.(filter.key, event.target.value)}
                    >
                      <option value="">All</option>
                      <option value="UNASSIGNED">Unassigned</option>
                      <option value="ASSIGNED">Assigned</option>
                      <option value="MINE">Assigned to me</option>
                    </select>
                  ) : (
                    <input
                      id={`queue-filter-${filter.key}`}
                      value={queue.appliedFilters[filter.key] ?? ''}
                      onChange={(event) => onFilterChange?.(filter.key, event.target.value)}
                    />
                  )}
                </div>
              ))
            ) : (
              <div className="optic-field">
                <label htmlFor="queue-filter-spacer">Assignment</label>
                <select id="queue-filter-spacer" tabIndex={-1} disabled>
                  <option value="">All</option>
                </select>
              </div>
            )}
          </div>
          {activeFilterChips.length > 0 ? (
            <div className="optic-queue-filter-chips" aria-label="Active filters">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="optic-queue-filter-chip"
                  onClick={() => onFilterChange?.(chip.key, '')}
                >
                  <span>
                    {chip.label}: {chip.valueLabel}
                  </span>
                  <span aria-hidden="true">×</span>
                  <span className="optic-visually-hidden">Clear {chip.label} filter</span>
                </button>
              ))}
              <button
                type="button"
                className="optic-queue-filter-clear"
                onClick={() => {
                  for (const chip of activeFilterChips) {
                    onFilterChange?.(chip.key, '');
                  }
                }}
              >
                Clear all
              </button>
            </div>
          ) : null}
        </fieldset>
      </form>

      <div className="optic-queue-table-wrap">
        <table className="optic-queue-table">
          <caption className="optic-visually-hidden">
            {queue.displayName} queue, page {queue.page} of {totalPages}
          </caption>
          <thead>
            <tr>
              {canBulk ? (
                <th scope="col" className="optic-queue-select">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    aria-label="Select all items on this page"
                    onChange={(event) =>
                      setSelected(event.target.checked ? queue.rows.map((row) => row.trackingId) : [])
                    }
                  />
                </th>
              ) : null}
              <th scope="col" className="optic-queue-index">
                <span aria-hidden="true">#</span>
                <span className="optic-visually-hidden">Row</span>
              </th>
              {queue.columns.map((column) => {
                const active = currentSort?.field === column.key;
                const nextDirection = active && currentSort?.direction === 'ASC' ? 'DESC' : 'ASC';
                return (
                  <th key={column.key} scope="col" aria-sort={ariaSort(column.key, currentSort)}>
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="optic-queue-sort"
                        onClick={() => onSortChange(column.key, nextDirection)}
                      >
                        {column.label}
                        <span aria-hidden="true">{sortMark(column.key, currentSort)}</span>
                        {active ? (
                          <span className="optic-visually-hidden">
                            {currentSort?.direction === 'ASC' ? 'sorted ascending' : 'sorted descending'}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
              {hasRowActions && <th scope="col" className="optic-queue-actions">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {queue.rows.length === 0 ? (
              <tr>
                <td colSpan={queue.columns.length + extraColumns}>
                  <div className="optic-queue-empty" role="status">
                    <span className="optic-empty-inline">
                      <Icon name="inbox" />
                      {loading ? 'Loading queue…' : (emptyHint ?? 'No items match this queue.')}
                    </span>
                    {!loading && onFindCase ? (
                      <button type="button" className="optic-button-secondary" onClick={onFindCase}>
                        <ButtonLabel icon="search">Find a case</ButtonLabel>
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : (
              queue.rows.map((row, index) => {
                const permissions = rowPermissions(row);
                const showOpen = rowOpens;
                const showAssign = canAssign && permissions.allowAssign;
                const showRelease = canRelease && onRelease && permissions.allowRelease;
                const showReassign = Boolean(onReassign && permissions.allowReassign);
                const rowActionCount =
                  (showOpen ? 1 : 0) +
                  (showAssign ? 1 : 0) +
                  (showRelease ? 1 : 0) +
                  (showReassign ? 1 : 0);
                return (
                <tr
                  key={row.workflowInstanceId}
                  className={[
                    openTrackingId === row.trackingId ? 'optic-queue-row-open' : undefined,
                    rowOpens ? 'optic-queue-row-clickable' : undefined
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined}
                  aria-current={openTrackingId === row.trackingId ? 'true' : undefined}
                  onClick={rowOpens ? () => onOpen?.(row) : undefined}
                >
                  {canBulk ? (
                    <td className="optic-queue-select" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.includes(row.trackingId)}
                        aria-label={`Select ${row.trackingId}`}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, row.trackingId]
                              : current.filter((id) => id !== row.trackingId)
                          )
                        }
                      />
                    </td>
                  ) : null}
                  <td className="optic-queue-index">{rowNumber(queue.page, queue.pageSize, index)}</td>
                  {queue.columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.key === 'trackingId' ? 'optic-queue-tracking' : undefined}
                    >
                      {column.key === 'trackingId' ? (
                        <TrackingIdLinkWithCopy
                          trackingId={row.trackingId}
                          onOpen={rowOpens ? () => onOpen?.(row) : undefined}
                        />
                      ) : (
                        formatCell(column.key, row.values[column.key])
                      )}
                    </td>
                  ))}
                  {hasRowActions && (
                    <td className="optic-queue-actions" onClick={(event) => event.stopPropagation()}>
                      {rowActionCount > 0 ? (
                        <div
                          className="optic-queue-row-actions"
                          role="group"
                          aria-label={`Actions for ${row.trackingId}`}
                        >
                          {showOpen ? (
                            <button
                              type="button"
                              className="optic-queue-action"
                              aria-label={`Open ${row.trackingId}`}
                              title="Open"
                              onClick={() => onOpen?.(row)}
                            >
                              <Icon name="form" />
                            </button>
                          ) : null}
                          {showAssign ? (
                            <button
                              type="button"
                              className="optic-queue-action"
                              disabled={row.assignedStatus === 'ASSIGNED'}
                              aria-label="Assign to me"
                              title="Assign to me"
                              onClick={() => onAssign?.(row)}
                            >
                              <Icon name="assign" />
                            </button>
                          ) : null}
                          {showRelease ? (
                            <button
                              type="button"
                              className="optic-queue-action"
                              disabled={!row.assignedTo || (actorId ? row.assignedTo !== actorId : false)}
                              aria-label="Release"
                              title="Release to queue"
                              onClick={() => onRelease?.(row)}
                            >
                              <Icon name="release" />
                            </button>
                          ) : null}
                          {showReassign ? (
                            <button
                              type="button"
                              className="optic-queue-action"
                              aria-label={`Reassign ${row.trackingId}`}
                              title="Reassign"
                              onClick={() => setReassigning(row)}
                            >
                              <Icon name="reassign" />
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="optic-queue-actions-empty" aria-hidden="true">
                          —
                        </span>
                      )}
                    </td>
                  )}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Bulk sits below the table so its presence cannot shove title/filters/columns. */}
      {canBulk ? (
        <form
          className="optic-bulk-toolbar"
          aria-label="Bulk actions"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="optic-bulk-toolbar-header">
            <p className="optic-queue-section-label">Bulk actions</p>
            <p className="optic-bulk-count" aria-live="polite">
              {selectedRows.length} selected
            </p>
          </div>
          {bulkActions.map((action) => (
            <fieldset key={action.bulkActionKey} className="optic-bulk-action">
              <legend className="optic-visually-hidden">{action.label}</legend>
              <div className="optic-bulk-action-row">
                {Object.entries(action.sharedInputSchema?.properties ?? {}).map(([key, schema]) => (
                  <div className="optic-field" key={`${action.bulkActionKey}-${key}`}>
                    <label htmlFor={`bulk-${action.bulkActionKey}-${key}`}>
                      {schema.title ?? key}
                      {action.sharedInputSchema?.required?.includes(key) ? ' (required)' : ''}
                    </label>
                    <input
                      id={`bulk-${action.bulkActionKey}-${key}`}
                      type={schema.format === 'date' ? 'date' : 'text'}
                      value={bulkInput[`${action.bulkActionKey}.${key}`] ?? ''}
                      required={action.sharedInputSchema?.required?.includes(key)}
                      maxLength={schema.maxLength}
                      aria-describedby={
                        schema.description ? `bulk-${action.bulkActionKey}-${key}-help` : undefined
                      }
                      onChange={(event) =>
                        setBulkInput((current) => ({
                          ...current,
                          [`${action.bulkActionKey}.${key}`]: event.target.value
                        }))
                      }
                    />
                    {schema.description ? (
                      <p id={`bulk-${action.bulkActionKey}-${key}-help`} className="optic-help">
                        {schema.description}
                      </p>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  disabled={selectedRows.length === 0 || selectedRows.length > action.maxSelection}
                  onClick={() =>
                    onBulkExecute?.(
                      action,
                      selectedRows,
                      Object.fromEntries(
                        Object.keys(action.sharedInputSchema?.properties ?? {}).map((key) => [
                          key,
                          bulkInput[`${action.bulkActionKey}.${key}`] ?? ''
                        ])
                      )
                    )
                  }
                >
                  {action.label}
                </button>
              </div>
            </fieldset>
          ))}
        </form>
      ) : null}

      {bulkResult ? (
        <div className="optic-bulk-result" role="status" aria-live="polite">
          <h2>Bulk result</h2>
          <p>
            {bulkResult.successfulItems} succeeded, {bulkResult.failedItems} failed ({bulkResult.status}).
          </p>
          <ul>
            {bulkResult.items.map((item) => (
              <li key={item.trackingId}>
                {item.trackingId}: {item.status}
                {item.errorMessage ? ` — ${item.errorMessage}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="optic-queue-pager">
        <PagerControls
          page={queue.page}
          totalPages={totalPages}
          ariaLabel="Queue pages"
          onPageChange={(next) => onPageChange?.(next)}
        />
      </div>
      {reassigning && onReassign ? (
        <ReassignDialog
          trackingId={reassigning.trackingId}
          onCancel={() => setReassigning(undefined)}
          onConfirm={(assignedTo) => {
            onReassign(reassigning, assignedTo);
            setReassigning(undefined);
          }}
        />
      ) : null}
    </section>
  );
}

function rowPermissions(row: DemoQueueRow): {
  allowAssign: boolean;
  allowReassign: boolean;
  allowRelease: boolean;
} {
  const completed = row.status === 'COMPLETED';
  return {
    allowAssign: row.allowAssign ?? !completed,
    allowReassign: row.allowReassign ?? !completed,
    allowRelease: row.allowRelease ?? true
  };
}

function rowNumber(page: number, pageSize: number, index: number): number {
  return (Math.max(1, page) - 1) * Math.max(0, pageSize) + index + 1;
}

function filterValueLabel(key: string, value: string): string {
  if (key === 'assignedStatus') {
    if (value === 'UNASSIGNED') {
      return 'Unassigned';
    }
    if (value === 'ASSIGNED') {
      return 'Assigned';
    }
    if (value === 'MINE') {
      return 'Assigned to me';
    }
  }
  return value;
}

function formatCell(column: string, value: string | number | null | undefined): ReactNode {
  if (value == null || value === '') {
    if (column === 'assignedTo' || column === 'assignedStatus') {
      return (
        <span className="optic-chip">
          <Icon name="user" />
          Unassigned
        </span>
      );
    }
    return '—';
  }
  if (column === 'assignedTo' || column === 'assignedStatus') {
    const actorId = String(value);
    return (
      <span className="optic-chip optic-chip-assigned" title={actorId}>
        <Icon name="user" />
        {officerDisplayName(actorId)}
      </span>
    );
  }
  if (column === 'slaState') {
    const label = formatSlaStateLabel(String(value));
    if (!label) {
      return '—';
    }
    return (
      <span className="optic-sla-badge" data-tone={slaStateTone(String(value))}>
        {label}
      </span>
    );
  }
  return String(value);
}

function ariaSort(
  field: string,
  current?: { field: string; direction: 'ASC' | 'DESC' }
): 'ascending' | 'descending' | 'none' {
  if (!current || current.field !== field) {
    return 'none';
  }
  return current.direction === 'ASC' ? 'ascending' : 'descending';
}

function sortMark(field: string, current?: { field: string; direction: 'ASC' | 'DESC' }): string {
  if (!current || current.field !== field) {
    return '';
  }
  return current.direction === 'ASC' ? ' ▲' : ' ▼';
}
