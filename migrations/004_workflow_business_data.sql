-- Slice 7: stage business document on the common workflow instance.
-- Mail/Workload domain tables remain the long-term home for workload_data.

ALTER TABLE workflow_instance
  ADD COLUMN business_data JSON NOT NULL DEFAULT (JSON_OBJECT());
