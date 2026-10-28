import { useCallback, useEffect, useState } from 'react';
import { ButtonLabel } from '../ui/Icon.js';
import { fetchHealthReady, type HealthCheckState, type HealthSnapshot } from './health-api.js';

function checkLabel(state: HealthCheckState): string {
  if (state === 'up') {
    return 'Up';
  }
  if (state === 'down') {
    return 'Down';
  }
  return 'Unknown';
}

function overallLabel(health: HealthSnapshot | undefined, loading: boolean): string {
  if (loading && !health) {
    return 'Checking…';
  }
  if (!health || health.status === 'unreachable') {
    return 'API unreachable';
  }
  if (health.status === 'ok') {
    return 'Ready';
  }
  return 'Degraded';
}

export function AdminIntegrationsPage() {
  const [health, setHealth] = useState<HealthSnapshot | undefined>();
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    const snapshot = await fetchHealthReady();
    setHealth(snapshot);
    setCheckedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const overall = overallLabel(health, loading);
  const overallTone =
    !health || health.status === 'unreachable'
      ? 'danger'
      : health.status === 'ok'
        ? 'ok'
        : 'warn';

  return (
    <section className="optic-admin-integrations" aria-labelledby="admin-integrations-heading">
      <header className="optic-designer-header optic-admin-features-header">
        <div>
          <h1 id="admin-integrations-heading">Integrations</h1>
          <p className="optic-help">
            Platform connectivity for this environment, plus outbound systems as they land.
          </p>
        </div>
        <button
          type="button"
          className="optic-guide-button"
          title="Re-check API and database readiness"
          aria-label="Refresh platform status"
          onClick={() => void load()}
          disabled={loading}
        >
          <ButtonLabel icon="undo">Refresh</ButtonLabel>
        </button>
      </header>

      <section
        className="optic-admin-platform-status"
        aria-labelledby="admin-platform-status-heading"
        aria-busy={loading}
      >
        <div className="optic-admin-platform-status-header">
          <h2 id="admin-platform-status-heading">Platform status</h2>
          <p className={`optic-admin-health-overall optic-admin-health-overall-${overallTone}`} role="status">
            {overall}
          </p>
        </div>
        <p className="optic-help">
          Uses <code>/health/ready</code> (API process and database). Apache should proxy{' '}
          <code>/health</code> along with <code>/api</code>.
        </p>
        <dl className="optic-admin-health-checks">
          <div>
            <dt>API process</dt>
            <dd data-state={health?.process ?? 'unknown'}>{checkLabel(health?.process ?? 'unknown')}</dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd data-state={health?.database ?? 'unknown'}>{checkLabel(health?.database ?? 'unknown')}</dd>
          </div>
        </dl>
        {checkedAt ? (
          <p className="optic-admin-health-checked" role="status">
            Last checked {checkedAt.toLocaleTimeString()}
            {health?.httpStatus != null ? ` · HTTP ${health.httpStatus}` : null}
          </p>
        ) : null}
      </section>

      <div className="optic-admin-coming-soon-panel" role="status">
        <p className="optic-admin-coming-soon-title">Outbound integrations</p>
        <p className="optic-help">
          Splunk, package export targets, and other connectors will appear here. This section stays reserved so
          Features, Audit trail, and Integrations remain in one place.
        </p>
      </div>
    </section>
  );
}
