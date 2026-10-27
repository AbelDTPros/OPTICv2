import { useState } from 'react';
import { ButtonLabel, type IconName } from '../ui/Icon.js';
import { AdminAuditPage } from './AdminAuditPage.js';
import { AdminFeaturesPage } from './AdminFeaturesPage.js';

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
    description: 'Outbound systems such as Splunk and package export targets.'
  }
];

export function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>('features');
  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  return (
    <div className="optic-admin-workspace">
      <aside className="optic-admin-sidebar" aria-label="Admin">
        <p className="optic-admin-sidebar-kicker">Administration</p>
        <nav className="optic-admin-sidebar-nav" aria-label="Admin sections">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              <ButtonLabel icon={item.icon}>{item.label}</ButtonLabel>
            </button>
          ))}
        </nav>
      </aside>
      <div className="optic-admin-content">
        {section === 'features' ? (
          <AdminFeaturesPage />
        ) : section === 'audit' ? (
          <AdminAuditPage />
        ) : (
          <AdminComingSoonPage title={active.label} description={active.description} />
        )}
      </div>
    </div>
  );
}

function AdminComingSoonPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="optic-admin-coming-soon" aria-labelledby="admin-coming-soon-heading">
      <header className="optic-designer-header optic-admin-features-header">
        <div>
          <h1 id="admin-coming-soon-heading">{title}</h1>
          <p className="optic-help">{description}</p>
        </div>
      </header>
      <div className="optic-admin-coming-soon-panel" role="status">
        <p className="optic-admin-coming-soon-title">Coming next</p>
        <p className="optic-help">
          This Admin section is reserved. The shell is ready so Features, Audit trail, and Integrations stay in one
          place as each capability lands.
        </p>
      </div>
    </section>
  );
}
