import { useCallback, useEffect, useState } from 'react';
import { getCurrentOfficerId } from '../actors/demo-officers.js';
import { asDisplayError, type DisplayError } from '../api/apply-api-error.js';
import type { DemoBulkResult, DemoQueuePage, DemoQueueRow } from './demo-queue.js';
import {
  assignFromQueue,
  executeBulkAction,
  fetchQueuePage,
  reassignFromQueue,
  releaseFromQueue
} from './optic-api.js';
import { QueueScreen } from './QueueScreen.js';

const LIVE_QUEUE_KEY = 'READY_FOR_SHIPPING';
const LIVE_DEFINITION_KEY = 'I_131_BULK';

export function LiveQueuePanel() {
  const [queue, setQueue] = useState<DemoQueuePage | null>(null);
  const [errorSummary, setErrorSummary] = useState<DisplayError | undefined>();
  const [loading, setLoading] = useState(true);
  const [bulkResult, setBulkResult] = useState<DemoBulkResult | undefined>();
  const [query, setQuery] = useState<{
    page: number;
    sort?: string;
    direction?: 'ASC' | 'DESC';
    filters: Record<string, string>;
  }>({ page: 1, filters: {} });

  const reload = useCallback(async () => {
    const page = await fetchQueuePage(LIVE_QUEUE_KEY, { ...query, definitionKey: LIVE_DEFINITION_KEY });
    setQueue(page);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .then(() => {
        if (!cancelled) {
          setErrorSummary(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorSummary(asDisplayError(error, 'The API is not reachable. Start `npm run dev`, migrate, and `npm run seed:bulk`.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function run(work: () => Promise<void>) {
    try {
      setErrorSummary(undefined);
      await work();
      await reload();
    } catch (error: unknown) {
      setErrorSummary(
        asDisplayError(error, 'The API is not reachable. Start `npm run dev`, migrate, and `npm run seed:bulk`.')
      );
    }
  }

  return (
    <QueueScreen
      queue={queue ?? emptyLiveQueue()}
      actorId={getCurrentOfficerId()}
      errorSummary={errorSummary}
      loading={loading && !queue}
      bulkResult={bulkResult}
      onAssign={(row) =>
        run(() =>
          assignFromQueue(LIVE_QUEUE_KEY, {
            definitionKey: LIVE_DEFINITION_KEY,
            entityType: row.entityType,
            trackingId: row.trackingId,
            expectedRowVersion: row.rowVersion
          })
        )
      }
      onRelease={(row) =>
        run(() =>
          releaseFromQueue(LIVE_QUEUE_KEY, {
            definitionKey: LIVE_DEFINITION_KEY,
            entityType: row.entityType,
            trackingId: row.trackingId,
            expectedRowVersion: row.rowVersion
          })
        )
      }
      onReassign={(row, assignedTo) =>
        run(() =>
          reassignFromQueue(LIVE_QUEUE_KEY, {
            definitionKey: LIVE_DEFINITION_KEY,
            entityType: row.entityType,
            trackingId: row.trackingId,
            expectedRowVersion: row.rowVersion,
            assignedTo
          })
        )
      }
      onBulkExecute={(action, rows, input) =>
        run(async () => {
          const result = await executeBulkAction(action.bulkActionKey, toBulkItems(rows), input);
          setBulkResult(result);
        })
      }
      onFilterChange={(key, value) =>
        setQuery((current) => ({ ...current, page: 1, filters: { ...current.filters, [key]: value } }))
      }
      onSortChange={(field, direction) => setQuery((current) => ({ ...current, sort: field, direction }))}
      onPageChange={(page) => setQuery((current) => ({ ...current, page }))}
    />
  );
}

function toBulkItems(rows: DemoQueueRow[]) {
  return rows.map((row) => ({
    entityType: row.entityType,
    trackingId: row.trackingId,
    expectedRowVersion: row.rowVersion
  }));
}

function emptyLiveQueue(): DemoQueuePage {
  return {
    queueKey: LIVE_QUEUE_KEY,
    displayName: 'Ready for Shipping',
    entityType: 'WORKLOAD',
    definitionKey: 'I_131_BULK',
    version: '',
    columns: [],
    filters: [],
    actions: [],
    bulkActions: [],
    page: 1,
    pageSize: 25,
    total: 0,
    sort: [],
    appliedFilters: {},
    rows: []
  };
}
