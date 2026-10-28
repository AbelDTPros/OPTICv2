import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { asDisplayError, type DisplayError } from '../api/apply-api-error.js';
import { TrackingIdLinkWithCopy } from '../tracking/TrackingIdDisplay.js';
import { CaughtErrorBanner } from '../ui/CaughtErrorBanner.js';
import { ButtonLabel } from '../ui/Icon.js';
import { PagerControls } from '../ui/PagerControls.js';
import {
  getAdminAuditEvent,
  getAdminAuditFilterOptions,
  listAdminAudit,
  type AuditActorOption,
  type AuditListItem,
  type AuditListQuery
} from './audit-api.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const EVENT_TYPE_OPTIONS = [
  '',
  'FEATURE_FLAG_CHANGED',
  'CONFIG_CHANGED',
  'CONFIG_SUBMITTED',
  'CONFIG_APPROVED',
  'CONFIG_PUBLISHED',
  'CONFIG_ACTIVATED',
  'MAIL_CREATED',
  'WORKLOAD_CREATED',
  'STAGE_TRANSITIONED',
  'WORKLOAD_ASSIGNED',
  'WORKLOAD_REASSIGNED',
  'BULK_ACTION_STARTED',
  'BULK_ACTION_COMPLETED',
  'AUTHORIZATION_DENIED',
  'SYSTEM_ERROR'
];

const EMPTY_FILTERS = {
  eventType: '',
  actorId: '',
  entityTrackingId: '',
  definitionKey: '',
  correlationId: ''
};

export function AdminAuditPage() {
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Omit<AuditListQuery, 'page' | 'limit'>>({});
  const [items, setItems] = useState<AuditListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [selected, setSelected] = useState<AuditListItem | null>(null);
  const [actorOptions, setActorOptions] = useState<AuditActorOption[]>([]);
  const [definitionOptions, setDefinitionOptions] = useState<string[]>([]);
  const [errorSummary, setErrorSummary] = useState<DisplayError | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  function queryFromDraft(next: typeof EMPTY_FILTERS): Omit<AuditListQuery, 'page' | 'limit'> {
    return {
      eventType: next.eventType || undefined,
      actorId: next.actorId.trim() || undefined,
      entityTrackingId: next.entityTrackingId.trim() || undefined,
      definitionKey: next.definitionKey.trim() || undefined,
      correlationId: next.correlationId.trim() || undefined
    };
  }

  const loadFilterOptions = useCallback(async () => {
    try {
      const options = await getAdminAuditFilterOptions();
      setActorOptions(options.actors);
      setDefinitionOptions(options.definitionKeys);
    } catch {
      // List load surfaces errors; empty dropdowns remain usable with All.
      setActorOptions([]);
      setDefinitionOptions([]);
    }
  }, []);

  const load = useCallback(
    async (
      nextPage: number,
      nextPageSize: number,
      nextFilters: Omit<AuditListQuery, 'page' | 'limit'>
    ) => {
      setLoading(true);
      setErrorSummary(undefined);
      try {
        const data = await listAdminAudit({
          ...nextFilters,
          page: nextPage,
          limit: nextPageSize
        });
        setItems(data.items);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setPage(data.page);
        setPageSize(data.pageSize);
        setSelected(null);
      } catch (error) {
        setItems([]);
        setTotal(0);
        setTotalPages(0);
        setErrorSummary(asDisplayError(error, 'Audit trail request failed.'));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(1, 25, {});
    void loadFilterOptions();
  }, [load, loadFilterOptions]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const next = queryFromDraft(draft);
    setAppliedFilters(next);
    void load(1, pageSize, next);
    void loadFilterOptions();
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setAppliedFilters({});
    void load(1, pageSize, {});
    void loadFilterOptions();
  }

  function changePageSize(nextSize: number) {
    setPageSize(nextSize);
    void load(1, nextSize, appliedFilters);
  }

  function goToPage(nextPage: number) {
    if (nextPage < 1 || (totalPages > 0 && nextPage > totalPages)) {
      return;
    }
    void load(nextPage, pageSize, appliedFilters);
  }

  async function openDetail(item: AuditListItem) {
    setLoadingDetail(true);
    setErrorSummary(undefined);
    try {
      setSelected(await getAdminAuditEvent(item.eventId));
    } catch (error) {
      setErrorSummary(asDisplayError(error, 'Audit trail request failed.'));
    } finally {
      setLoadingDetail(false);
    }
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const actorsForSelect =
    draft.actorId && !actorOptions.some((actor) => actor.value === draft.actorId)
      ? [...actorOptions, { value: draft.actorId, label: draft.actorId }]
      : actorOptions;
  const definitionsForSelect =
    draft.definitionKey && !definitionOptions.includes(draft.definitionKey)
      ? [...definitionOptions, draft.definitionKey]
      : definitionOptions;

  return (
    <section className="optic-admin-audit" aria-labelledby="admin-audit-heading">
      <header className="optic-designer-header optic-admin-features-header">
        <div>
          <h1 id="admin-audit-heading">Audit trail</h1>
          <p className="optic-help">
            Append-only record of configuration, feature, and operational events for this environment.
          </p>
        </div>
        <button
          type="button"
          className="optic-guide-button"
          title="Clear all filters and reload the audit trail."
          aria-label="Reset audit filters"
          onClick={resetFilters}
          disabled={loading}
        >
          <ButtonLabel icon="undo">Reset</ButtonLabel>
        </button>
      </header>

      <form className="optic-admin-audit-filters" onSubmit={applyFilters}>
        <label>
          Event type
          <select
            value={draft.eventType}
            onChange={(event) => setDraft((current) => ({ ...current, eventType: event.target.value }))}
          >
            <option value="">All types</option>
            {EVENT_TYPE_OPTIONS.filter(Boolean).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Actor
          <select
            value={draft.actorId}
            onChange={(event) => setDraft((current) => ({ ...current, actorId: event.target.value }))}
          >
            <option value="">All actors</option>
            {actorsForSelect.map((actor) => (
              <option key={actor.value} value={actor.value}>
                {actor.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tracking id
          <input
            value={draft.entityTrackingId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, entityTrackingId: event.target.value }))
            }
            placeholder="contains tracking id"
          />
        </label>
        <label>
          Definition
          <select
            value={draft.definitionKey}
            onChange={(event) => setDraft((current) => ({ ...current, definitionKey: event.target.value }))}
          >
            <option value="">All definitions</option>
            {definitionsForSelect.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <label>
          Correlation
          <input
            value={draft.correlationId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, correlationId: event.target.value }))
            }
            placeholder="contains correlation id"
          />
        </label>
        <div className="optic-admin-audit-filter-actions">
          <button type="submit" className="optic-button-primary" disabled={loading}>
            Apply filters
          </button>
        </div>
      </form>

      {errorSummary ? (
        <CaughtErrorBanner error={errorSummary} />
      ) : null}

      <div className="optic-admin-audit-toolbar">
        <label className="optic-admin-audit-page-size">
          Rows per page
          <select
            value={pageSize}
            disabled={loading}
            onChange={(event) => changePageSize(Number(event.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <p className="optic-help optic-admin-audit-count" role="status">
          {loading
            ? 'Loading…'
            : total === 0
              ? 'No events'
              : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()}`}
        </p>
        <PagerControls
          page={page}
          totalPages={totalPages}
          disabled={loading}
          ariaLabel="Audit pages"
          onPageChange={goToPage}
        />
      </div>

      <div className="optic-admin-audit-layout">
        <div className="optic-admin-audit-list-pane">
          {loading ? (
            <p className="optic-help" role="status" aria-live="polite">
              Loading audit events…
            </p>
          ) : null}
          {!loading && items.length === 0 ? (
            <p className="optic-help" role="status">
              No audit events match these filters.
            </p>
          ) : null}
          {items.length > 0 ? (
            <div className="optic-queue-table-wrap">
              <table className="optic-queue-table optic-admin-audit-table">
                <caption className="optic-visually-hidden">Audit events</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Type</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.eventId}
                      className={`optic-queue-row-clickable${
                        selected?.eventId === item.eventId ? ' optic-queue-row-open' : ''
                      }`}
                      onClick={() => void openDetail(item)}
                    >
                      <td>{formatWhen(item.occurredAt)}</td>
                      <td>
                        <code className="optic-admin-audit-type">{item.eventType}</code>
                      </td>
                      <td>{item.actorName || item.actorId || '—'}</td>
                      <td
                        className="optic-admin-audit-entity"
                        onClick={item.entityTrackingId ? (event) => event.stopPropagation() : undefined}
                      >
                        {item.entityTrackingId ? (
                          <TrackingIdLinkWithCopy trackingId={item.entityTrackingId} />
                        ) : (
                          item.definitionKey || item.entityType || '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <aside className="optic-admin-audit-detail" aria-label="Audit event detail">
          {loadingDetail ? <p className="optic-help">Loading event…</p> : null}
          {!loadingDetail && !selected ? (
            <p className="optic-help">Select an event to inspect its payload and hash chain fields.</p>
          ) : null}
          {!loadingDetail && selected ? (
            <div>
              <h2 className="optic-admin-audit-detail-title">{selected.eventType}</h2>
              <dl className="optic-admin-audit-dl">
                <div>
                  <dt>Occurred</dt>
                  <dd>{new Date(selected.occurredAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Event id</dt>
                  <dd>
                    <code>{selected.eventId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Actor</dt>
                  <dd>{selected.actorName || selected.actorId || '—'}</dd>
                </div>
                <div>
                  <dt>Correlation</dt>
                  <dd>
                    <code>{selected.correlationId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Entity</dt>
                  <dd className="optic-admin-audit-entity-detail">
                    {selected.entityType || selected.entityTrackingId ? (
                      <>
                        {selected.entityType ? <span>{selected.entityType}</span> : null}
                        {selected.entityType && selected.entityTrackingId ? (
                          <span aria-hidden="true"> · </span>
                        ) : null}
                        {selected.entityTrackingId ? (
                          <TrackingIdLinkWithCopy trackingId={selected.entityTrackingId} />
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Definition</dt>
                  <dd>
                    {[selected.definitionKey, selected.definitionVersion].filter(Boolean).join(' @ ') || '—'}
                  </dd>
                </div>
                <div>
                  <dt>Stage / action</dt>
                  <dd>
                    {[selected.stageKey, selected.actionKey].filter(Boolean).join(' · ') || '—'}
                  </dd>
                </div>
                <div>
                  <dt>Event hash</dt>
                  <dd>
                    <code className="optic-admin-audit-hash">{selected.eventHash}</code>
                  </dd>
                </div>
                <div>
                  <dt>Previous hash</dt>
                  <dd>
                    <code className="optic-admin-audit-hash">{selected.previousHash || '—'}</code>
                  </dd>
                </div>
              </dl>
              <h3 className="optic-admin-audit-payload-heading">Event data</h3>
              <pre className="optic-admin-audit-payload">
                {JSON.stringify(selected.eventData ?? {}, null, 2)}
              </pre>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

