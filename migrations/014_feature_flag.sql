-- Product feature flags (admin UI/API). Seed known keys; toggles persist per environment.

CREATE TABLE IF NOT EXISTS feature_flag (
  flag_key VARCHAR(128) NOT NULL,
  enabled TINYINT(1) NOT NULL,
  description VARCHAR(512) NOT NULL,
  row_version INT NOT NULL DEFAULT 1,
  updated_at DATETIME(6) NOT NULL,
  updated_by VARCHAR(255) NOT NULL,
  PRIMARY KEY (flag_key)
);

INSERT INTO feature_flag (flag_key, enabled, description, row_version, updated_at, updated_by)
VALUES
  ('ui.shell.workspace', 1, 'Officer Workspace primary navigation and screens.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.shell.designer', 1, 'Designer primary navigation and configuration screens.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.workspace.try_mode', 1, 'Workspace Try (draft rehearsal) mode toggle.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.workspace.search', 1, 'Find a case search in the officer workspace.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.designer.catalog.sla', 1, 'Catalog designer SLA type.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.designer.catalog.bulk', 1, 'Catalog designer Bulk actions type.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.designer.catalog.scheduled', 1, 'Catalog designer Scheduled actions type.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.designer.catalog.search', 1, 'Catalog designer Search type.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.designer.try', 1, 'Designer Try as officer tab.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.designer.simulate', 1, 'Designer Simulate tab.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.designer.lifecycle', 1, 'Designer Lifecycle tab.', 1, UTC_TIMESTAMP(6), 'system'),
  ('ui.designer.diff', 1, 'Designer Diff tab.', 1, UTC_TIMESTAMP(6), 'system'),
  ('api.search', 1, 'Search API (/api/v1/search).', 1, UTC_TIMESTAMP(6), 'system'),
  ('api.bulk_actions', 1, 'Bulk action API (/api/v1/bulk-actions).', 1, UTC_TIMESTAMP(6), 'system')
ON DUPLICATE KEY UPDATE
  description = VALUES(description);
