import { useEffect, useRef, useState } from 'react';
import type { SearchFieldDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { asDisplayError, type DisplayError } from '../api/apply-api-error.js';
import { SearchApiError } from '../api/api-error.js';
import { officerDisplayName } from '../actors/demo-officers.js';
import { TrackingIdLinkWithCopy } from '../tracking/TrackingIdDisplay.js';
import { CaughtErrorBanner } from '../ui/CaughtErrorBanner.js';
import { ButtonLabel, Icon } from '../ui/Icon.js';
import { findCases, shouldOpenSingleHit, type SearchHit, type SearchPage } from './search-api.js';

const NO_EXTRA_FIELDS: SearchFieldDefinition[] = [];

export function SearchScreen({
  headingLevel = 1,
  title = 'Find a case',
  compact = false,
  openTrackingId,
  extraFields = NO_EXTRA_FIELDS,
  definitionKeys,
  onOpen
}: {
  headingLevel?: 1 | 2 | 3;
  title?: string;
  compact?: boolean;
  openTrackingId?: string;
  /** Catalog Search extras for the selected workload type (not the four built-ins). */
  extraFields?: SearchFieldDefinition[];
  /** When set, Find a case only returns cases for these definition keys. */
  definitionKeys?: string[];
  onOpen?: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [entityType, setEntityType] = useState('');
  const [currentStageKey, setCurrentStageKey] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [criteria, setCriteria] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [page, setPage] = useState<SearchPage | undefined>();
  const [errorSummary, setErrorSummary] = useState<DisplayError | undefined>();
  const [searching, setSearching] = useState(false);
  const trackingInput = useRef<HTMLInputElement>(null);
  const hasCriteria = Object.values(criteria).some((value) => value.trim());
  const advancedActiveCount =
    (entityType.trim() ? 1 : 0) +
    (currentStageKey.trim() ? 1 : 0) +
    (assignedTo.trim() ? 1 : 0) +
    Object.values(criteria).filter((value) => value.trim()).length;
  const canClear = Boolean(
    q || receiptNumber || entityType || currentStageKey || assignedTo || hasCriteria || page || errorSummary
  );

  useEffect(() => {
    const allowed = new Set(extraFields.map((field) => field.fieldKey));
    setCriteria((current) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [key, value] of Object.entries(current)) {
        if (allowed.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      }
      if (!changed && Object.keys(next).length === Object.keys(current).length) {
        return current;
      }
      return next;
    });
  }, [extraFields]);

  const definitionScopeKey = (definitionKeys ?? []).join('\0');
  useEffect(() => {
    setPage(undefined);
    setErrorSummary(undefined);
  }, [definitionScopeKey]);

  function clearSearch() {
    setQ('');
    setReceiptNumber('');
    setEntityType('');
    setCurrentStageKey('');
    setAssignedTo('');
    setCriteria({});
    setAdvancedOpen(false);
    setPage(undefined);
    setErrorSummary(undefined);
    trackingInput.current?.focus();
  }

  async function runSearch() {
    setSearching(true);
    try {
      setErrorSummary(undefined);
      const next = await findCases({
        q,
        receiptNumber: receiptNumber || undefined,
        entityType: entityType || undefined,
        definitionKeys,
        currentStageKey: currentStageKey || undefined,
        assignedTo: assignedTo.trim() || undefined,
        criteria: Object.fromEntries(
          Object.entries(criteria).filter(([, value]) => value.trim())
        )
      });
      setPage(next);
      if (onOpen && shouldOpenSingleHit(next.hits, q)) {
        onOpen(next.hits[0]!);
      }
    } catch (error: unknown) {
      setPage(undefined);
      setErrorSummary(
        error instanceof SearchApiError
          ? error
          : asDisplayError(
              error,
              'The search API is not reachable. Start `npm run dev` so Vite can proxy /api.'
            )
      );
    } finally {
      setSearching(false);
    }
  }

  const Heading = headingLevel === 3 ? 'h3' : headingLevel === 2 ? 'h2' : 'h1';
  const helpScope =
    definitionKeys && definitionKeys.length > 0
      ? ' Results are limited to the selected Workload Type.'
      : '';
  const helpExtras =
    extraFields.length > 0
      ? ` Catalog extras for this type: ${extraFields.map((field) => searchFieldLabel(field.fieldKey)).join(', ')}.`
      : '';
  const advancedFields = (
    <>
      <label>
        Entity type
        <input
          value={entityType}
          onChange={(event) => setEntityType(event.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          placeholder="MAIL or WORKLOAD"
        />
      </label>
      <label>
        Stage
        <input
          value={currentStageKey}
          onChange={(event) => setCurrentStageKey(event.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          placeholder="READY_FOR_DATA_ENTRY"
        />
      </label>
      <label>
        Assignee
        <input
          value={assignedTo}
          onChange={(event) => setAssignedTo(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Name or email"
        />
      </label>
      {extraFields.map((field) => {
        const label = searchFieldLabel(field.fieldKey);
        return (
          <label key={field.fieldKey}>
            {label}
            <input
              value={criteria[field.fieldKey] ?? ''}
              onChange={(event) =>
                setCriteria((current) => ({ ...current, [field.fieldKey]: event.target.value }))
              }
              autoComplete="off"
              spellCheck={false}
              placeholder={field.path}
            />
          </label>
        );
      })}
    </>
  );

  return (
    <section
      className={compact ? 'optic-workspace-search optic-workspace-search-compact' : 'optic-queue optic-workspace-search'}
      aria-labelledby="search-heading"
    >
      <header className={compact ? 'optic-workspace-search-header' : 'optic-queue-header'}>
        <div>
          <Heading id="search-heading">
            <ButtonLabel icon="search">{title}</ButtonLabel>
          </Heading>
          <p className="optic-help">
            {compact
              ? 'Scan a sticker, or search by tracking ID or receipt number. Open Advanced for entity type, stage, assignee, and catalog extras.'
              : 'Scan a sticker or type any part of the tracking ID. Receipt number, entity type, stage, assignee, and catalog extras narrow the list.'}
            {helpScope}
            {helpExtras}
            {onOpen && !compact ? ' Click a result to open it.' : ''}
          </p>
        </div>
      </header>
      <CaughtErrorBanner error={errorSummary} />
      {searching ? (
        <p className="optic-help" role="status" aria-live="polite">
          Searching…
        </p>
      ) : null}
      <form
        className="optic-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <label>
          Tracking ID
          <input
            id="optic-find-case-tracking"
            ref={trackingInput}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Scan a label or type part of a tracking ID"
          />
        </label>
        <label>
          Receipt number
          <input
            value={receiptNumber}
            onChange={(event) => setReceiptNumber(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="MSC1234567890"
          />
        </label>
        {compact ? (
          <details
            className="optic-search-advanced"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>
              Advanced search
              {advancedActiveCount > 0 ? (
                <span className="optic-search-advanced-count">
                  {' '}
                  · {advancedActiveCount} active
                </span>
              ) : null}
            </summary>
            {advancedOpen ? <div className="optic-search-advanced-fields">{advancedFields}</div> : null}
          </details>
        ) : (
          advancedFields
        )}
        <div className="optic-search-actions">
          <button type="submit" className="optic-button-primary">
            <ButtonLabel icon="search">Search</ButtonLabel>
          </button>
          <button type="button" disabled={!canClear} onClick={clearSearch}>
            <ButtonLabel icon="clear">Clear</ButtonLabel>
          </button>
        </div>
      </form>
      {page ? (
        <div className="optic-search-results optic-search-results-enter">
          <p id="search-results-status" className="optic-search-results-status" role="status">
            {page.total} {page.total === 1 ? 'result' : 'results'}
            {page.q ? ` for tracking ${page.q}` : ''}
            {page.receiptNumber ? ` for receipt ${page.receiptNumber}` : ''}
          </p>
          {page.hits.length === 0 ? (
            <p className="optic-empty" role="status">
              No matching records.
            </p>
          ) : (
            <ul className="optic-search-hits" aria-labelledby="search-results-status">
              {page.hits.map((hit, index) => {
                const indexNumber = rowNumber(page.page, page.pageSize, index);
                return (
                  <li key={`${hit.entityType}-${hit.trackingId}`}>
                    <SearchHitRow
                      hit={hit}
                      index={indexNumber}
                      current={openTrackingId === hit.trackingId}
                      onOpen={onOpen}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : compact ? null : (
        <p className="optic-empty" role="status">
          Enter a query to find a mail item or workload.
        </p>
      )}
    </section>
  );
}

export function searchFieldLabel(fieldKey: string): string {
  if (!fieldKey.trim()) {
    return 'Extra field';
  }
  return fieldKey
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function SearchHitRow({
  hit,
  index,
  current,
  onOpen
}: {
  hit: SearchHit;
  index: number;
  current: boolean;
  onOpen?: (hit: SearchHit) => void;
}) {
  const receipt =
    hit.matchedFields.find((field) => field.fieldKey === 'receiptNumber' || /receipt/i.test(field.fieldKey))
      ?.value ?? null;
  const highlight = hit.matchedFields.filter(
    (field) =>
      field.fieldKey !== 'trackingId' &&
      field.fieldKey !== 'receiptNumber' &&
      !/receipt/i.test(field.fieldKey)
  );
  const stageLabel = humanizeStageKey(hit.currentStageKey);
  const meta = (
    <>
      <span className="optic-search-hit-meta">
        <span className="optic-search-hit-entity">{hit.entityType}</span>
        {receipt ? <span className="optic-search-hit-receipt">{receipt}</span> : null}
        <span>{stageLabel}</span>
        <span>{officerDisplayName(hit.assignedTo)}</span>
      </span>
      {highlight.length > 0 ? (
        <span className="optic-search-hit-match">
          {highlight.map((field) => `${searchFieldLabel(field.fieldKey)}: ${field.value}`).join(' · ')}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={`optic-search-hit${onOpen ? ' optic-search-hit-interactive' : ''}`}
      aria-current={current ? 'true' : undefined}
    >
      <span className="optic-search-hit-index" aria-hidden="true">
        {index}
      </span>
      <span className="optic-search-hit-body">
        <span className="optic-search-hit-id">
          <Icon name="scan" />
          <TrackingIdLinkWithCopy
            trackingId={hit.trackingId}
            onOpen={onOpen ? () => onOpen(hit) : undefined}
          />
        </span>
        {onOpen ? (
          <button
            type="button"
            className="optic-search-hit-open"
            aria-label={`Open ${hit.entityType} ${hit.trackingId}, row ${index}`}
            onClick={() => onOpen(hit)}
          >
            {meta}
          </button>
        ) : (
          meta
        )}
      </span>
    </div>
  );
}

function humanizeStageKey(stageKey: string): string {
  return stageKey
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function rowNumber(page: number, pageSize: number, index: number): number {
  return (Math.max(1, page) - 1) * Math.max(0, pageSize) + index + 1;
}
