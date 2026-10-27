-- Slice 17: spawned workloads remember the mail item they arrived in.
-- Officers open a workload and still read the parent mail stage screens.

ALTER TABLE workflow_instance
  ADD COLUMN parent_entity_type VARCHAR(50) NULL AFTER entity_tracking_id,
  ADD COLUMN parent_tracking_id VARCHAR(255) NULL AFTER parent_entity_type,
  ADD KEY ix_workflow_parent (parent_entity_type, parent_tracking_id);
