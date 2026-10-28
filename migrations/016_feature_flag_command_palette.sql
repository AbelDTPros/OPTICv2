-- Shell command palette (Jump to…) feature flag.

INSERT INTO feature_flag (flag_key, enabled, description, row_version, updated_at, updated_by)
VALUES
  (
    'ui.shell.command_palette',
    1,
    'Command palette (Jump to…) and ⌘K / Ctrl+K shortcut in the shell.',
    1,
    UTC_TIMESTAMP(6),
    'system'
  )
ON DUPLICATE KEY UPDATE
  description = VALUES(description);
