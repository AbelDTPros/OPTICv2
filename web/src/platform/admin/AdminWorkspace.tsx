import { useEffect, useState } from 'react';
import {
  APP_NAVIGATE_EVENT,
  consumeAdminFocusHint,
  type AdminFocusHint
} from '../navigation/app-navigation.js';
import { ButtonLabel, type IconName } from '../ui/Icon.js';
import { AdminAuditPage } from './AdminAuditPage.js';
import { AdminFeaturesPage } from './AdminFeaturesPage.js';
import { AdminIntegrationsPage } from './AdminIntegrationsPage.js';

export type AdminSection = 'features' | 'audit' | 'integrations';

const SECTIONS: Array<{ id: AdminSection; label: string; icon: IconName; description: string }> = [
  {
    id: 'features',
    label: 'Features',
    icon: 'check',
    description: 'Product surfaces and API gates for this environment.'
  },
  {
    id: 'audit',
    label: 'Audit trail',
    icon: 'clock',
    description: 'Who changed configuration, features, and operational data.'
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: 'inbox',
    description: 'Platform connectivity and outbound systems such as Splunk.'
  }
];

function isAdminSection(value: string | undefined): value is AdminSection {
  return value === 'features' || value === 'audit' || value === 'integrations';
}

export function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>(() => {
    const hint = consumeAdminFocusHint();
    return isAdminSection(hint?.section) ? hint.section : 'features';
  });
  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  useEffect(() => {
    function onNavigate(event: Event) {
      const detail = (
        event as CustomEvent<{ view?: string; adminFocus?: AdminFocusHint }>
      ).detail;
      if (detail?.view !== 'admin' || !isAdminSection(detail.adminFocus?.section)) {
        return;
      }
      setSection(detail.adminFocus.section);
    }
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate);
  }, []);

  return (
    <div className="optic-admin-shell">
      <header className="optic-admin-page-intro">
        <div>
          <p className="optic-designer-kicker">Administration</p>
          <p className="optic-designer-page-title">Admin</p>
          <p className="optic-help">Environment controls, audit history, and platform connectivity.</p>
        </div>
        <p className="optic-admin-page-intro-status" aria-label="Current section">
          {active.label}
        </p>
      </header>
      <div className="optic-admin-workspace">
        <aside className="optic-admin-sidebar" aria-label="Admin">
          <p className="optic-admin-sidebar-kicker">Administration</p>
          <nav className="optic-admin-sidebar-nav" aria-label="Admin sections">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={section === item.id ? 'page' : undefined}
                title={item.description}
                onClick={() => setSection(item.id)}
              >
                <ButtonLabel icon={item.icon}>{item.label}</ButtonLabel>
              </button>
            ))}
          </nav>
        </aside>
        <div className="optic-admin-content optic-view-enter">
          {section === 'features' ? (
            <AdminFeaturesPage />
          ) : section === 'audit' ? (
            <AdminAuditPage />
          ) : (
            <AdminIntegrationsPage />
          )}
        </div>
      </div>
    </div>
  );
}
