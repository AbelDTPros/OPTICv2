-- Slice 11: lease lookup for due PENDING scheduled actions.

ALTER TABLE scheduled_workflow_action
  ADD KEY ix_scheduled_lease (status, lease_expires_at);
