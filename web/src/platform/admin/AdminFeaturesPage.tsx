import { useCallback, useEffect, useMemo, useState } from 'react';
import { DesignerApiError } from '../designers/config-api.js';
import {
  listAdminFeatures,
  updateAdminFeature,
  type AdminFeatureFlag,
  type FeatureAdminGates
} from '../features/feature-api.js';
import { useFeatureFlags } from '../features/FeatureFlagsContext.js';
import { DesignerErrorBody, ErrorSummary } from '../ui/ErrorSummary.js';
import { ButtonLabel } from '../ui/Icon.js';

const GROUP_LABELS: Record<string, string> = {
  shell: 'Navigation',
  workspace: 'Workspace',
  designer: 'Designer',
  api: 'APIs'
};

export function AdminFeaturesPage() {
  const { refresh: refreshShellFlags } = useFeatureFlags();
  const [flags, setFlags] = useState<AdminFeatureFlag[]>([]);
  const [admin, setAdmin] = useState<FeatureAdminGates | null>(null);
  const [errorSummary, setErrorSummary] = useState<string>();
  const [savingKey, setSavingKey] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorSummary(undefined);
    try {
      const data = await listAdminFeatures();
      setFlags(data.flags);
      setAdmin(data.admin);
    } catch (error) {
      setFlags([]);
      setAdmin(null);
      setErrorSummary(formatAdminError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const groups = new Map<string, AdminFeatureFlag[]>();
    for (const flag of flags) {
      const list = groups.get(flag.group) ?? [];
      list.push(flag);
      groups.set(flag.group, list);
    }
    return ['shell', 'workspace', 'designer', 'api']
      .filter((group) => groups.has(group))
      .map((group) => ({ group, label: GROUP_LABELS[group] ?? group, flags: groups.get(group) ?? [] }));
  }, [flags]);

  async function toggleFlag(flag: AdminFeatureFlag) {
    setSavingKey(flag.key);
    setErrorSummary(undefined);
    try {
      const updated = await updateAdminFeature(flag.key, {
        enabled: !flag.enabled,
        expectedRowVersion: flag.rowVersion
      });
      setFlags((current) => current.map((item) => (item.key === updated.key ? updated : item)));
      await refreshShellFlags();
    } catch (error) {
      setErrorSummary(formatAdminError(error));
    } finally {
      setSavingKey(undefined);
    }
  }

  return (
    <section className="optic-admin-features" aria-labelledby="admin-features-heading">
      <header className="optic-designer-header optic-admin-features-header">
        <div>
          <h1 id="admin-features-heading">Product features</h1>
          <p className="optic-help">
            Toggle surfaces for this environment. Admin visibility is gated by{' '}
            <code>FEATURE_ADMIN_UI</code> / <code>FEATURE_ADMIN_API</code>.
            {admin && !admin.apiEnabled ? ' Saving is disabled until FEATURE_ADMIN_API=true.' : null}
          </p>
        </div>
        <button
          type="button"
          className="optic-guide-button"
          title="Reload the feature list from the server. Picks up changes made in another session; does not change toggles by itself."
          aria-label="Refresh feature list from server"
          onClick={() => void load()}
          disabled={loading}
        >
          <ButtonLabel icon="undo">Refresh</ButtonLabel>
        </button>
      </header>

      {errorSummary ? (
        <ErrorSummary key={errorSummary} focus>
          <DesignerErrorBody message={errorSummary} />
        </ErrorSummary>
      ) : null}

      {loading ? <p className="optic-help">Loading feature flags…</p> : null}

      {!loading && grouped.length === 0 && !errorSummary ? (
        <p className="optic-help">No feature flags are available.</p>
      ) : null}

      <div className="optic-admin-feature-groups">
        {grouped.map((section) => (
          <section key={section.group} className="optic-admin-feature-group" aria-labelledby={`admin-group-${section.group}`}>
            <h2 id={`admin-group-${section.group}`} className="optic-admin-feature-group-title">
              {section.label}
            </h2>
            <ul className="optic-admin-feature-list">
              {section.flags.map((flag) => (
                <li key={flag.key} className="optic-admin-feature-row">
                  <div className="optic-admin-feature-copy">
                    <p className="optic-admin-feature-label">{flag.label}</p>
                    <p className="optic-help optic-admin-feature-desc" title={flag.description}>
                      {flag.description}
                    </p>
                    <p
                      className="optic-admin-feature-key"
                      title={`${flag.key} · updated by ${flag.updatedBy} · v${flag.rowVersion}`}
                    >
                      {flag.key}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    className="optic-switch"
                    aria-checked={flag.enabled}
                    aria-label={flag.label}
                    disabled={Boolean(savingKey) || admin?.apiEnabled === false}
                    onClick={() => void toggleFlag(flag)}
                  >
                    <span className="optic-switch-track" aria-hidden="true">
                      <span className="optic-switch-thumb" />
                    </span>
                    <span className="optic-switch-state">{flag.enabled ? 'On' : 'Off'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

function formatAdminError(error: unknown): string {
  if (error instanceof DesignerApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Feature admin request failed.';
}
