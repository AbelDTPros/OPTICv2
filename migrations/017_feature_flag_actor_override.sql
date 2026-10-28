-- Demo Signed in as / actor override (temporary until ICAM).

INSERT INTO feature_flag (flag_key, enabled, description, row_version, updated_at, updated_by)
VALUES
  (
    'ui.workspace.actor_override',
    1,
    'Editable Signed in as (demo actor). Turn off to pin the default demo officer until ICAM auth.',
    1,
    UTC_TIMESTAMP(6),
    'system'
  )
ON DUPLICATE KEY UPDATE
  description = VALUES(description);
