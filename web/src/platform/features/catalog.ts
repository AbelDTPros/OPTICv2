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

export type FeatureFlagMap = Record<FeatureFlagKey, boolean>;

export const ALL_FEATURES_ENABLED: FeatureFlagMap = Object.fromEntries(
  FEATURE_FLAG_KEYS.map((key) => [key, true])
) as FeatureFlagMap;
