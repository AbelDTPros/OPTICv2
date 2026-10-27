export const FEATURE_FLAG_KEYS = [
  'ui.shell.workspace',
  'ui.shell.designer',
  'ui.workspace.try_mode',
  'ui.workspace.search',
  'ui.designer.catalog.sla',
  'ui.designer.catalog.bulk',
  'ui.designer.catalog.scheduled',
  'ui.designer.catalog.search',
  'ui.designer.try',
  'ui.designer.simulate',
  'ui.designer.lifecycle',
  'ui.designer.diff',
  'api.search',
  'api.bulk_actions'
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export interface FeatureFlagDefinition {
  key: FeatureFlagKey;
  /** Short product-facing title for Admin UI. */
  label: string;
  description: string;
  defaultEnabled: boolean;
  group: 'shell' | 'workspace' | 'designer' | 'api';
}

export const FEATURE_FLAG_CATALOG: FeatureFlagDefinition[] = [
  {
    key: 'ui.shell.workspace',
    label: 'Workspace',
    description: 'Officer Workspace in the primary navigation.',
    defaultEnabled: true,
    group: 'shell'
  },
  {
    key: 'ui.shell.designer',
    label: 'Designer',
    description: 'Configuration Designer in the primary navigation.',
    defaultEnabled: true,
    group: 'shell'
  },
  {
    key: 'ui.workspace.try_mode',
    label: 'Try mode',
    description: 'Draft rehearsal (Try) toggle in the officer workspace.',
    defaultEnabled: true,
    group: 'workspace'
  },
  {
    key: 'ui.workspace.search',
    label: 'Find a case',
    description: 'Case search in the officer workspace.',
    defaultEnabled: true,
    group: 'workspace'
  },
  {
    key: 'ui.designer.catalog.sla',
    label: 'Catalog · SLAs',
    description: 'SLA building blocks in the Catalog designer.',
    defaultEnabled: true,
    group: 'designer'
  },
  {
    key: 'ui.designer.catalog.bulk',
    label: 'Catalog · Bulk',
    description: 'Bulk action building blocks in the Catalog designer.',
    defaultEnabled: true,
    group: 'designer'
  },
  {
    key: 'ui.designer.catalog.scheduled',
    label: 'Catalog · Scheduled',
    description: 'Scheduled action building blocks in the Catalog designer.',
    defaultEnabled: true,
    group: 'designer'
  },
  {
    key: 'ui.designer.catalog.search',
    label: 'Catalog · Search',
    description: 'Search field configuration in the Catalog designer.',
    defaultEnabled: true,
    group: 'designer'
  },
  {
    key: 'ui.designer.try',
    label: 'Try as officer',
    description: 'Rehearse a draft as an officer from Designer.',
    defaultEnabled: true,
    group: 'designer'
  },
  {
    key: 'ui.designer.simulate',
    label: 'Simulate',
    description: 'Transition simulation tab in Designer.',
    defaultEnabled: true,
    group: 'designer'
  },
  {
    key: 'ui.designer.lifecycle',
    label: 'Lifecycle',
    description: 'Submit, approve, publish, and activate releases.',
    defaultEnabled: true,
    group: 'designer'
  },
  {
    key: 'ui.designer.diff',
    label: 'Diff',
    description: 'Compare two release versions in Designer.',
    defaultEnabled: true,
    group: 'designer'
  },
  {
    key: 'api.search',
    label: 'Search API',
    description: 'HTTP search endpoints used by Find a case.',
    defaultEnabled: true,
    group: 'api'
  },
  {
    key: 'api.bulk_actions',
    label: 'Bulk actions API',
    description: 'HTTP endpoints for bulk operations.',
    defaultEnabled: true,
    group: 'api'
  }
];

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(value);
}

export function catalogEntry(key: FeatureFlagKey): FeatureFlagDefinition {
  const found = FEATURE_FLAG_CATALOG.find((item) => item.key === key);
  if (!found) {
    throw new Error(`Unknown feature flag ${key}`);
  }
  return found;
}
