-- Slice 10: relational queue projection. Queries use indexed columns, not JSONPath on business_data.

CREATE TABLE IF NOT EXISTS workflow_queue_projection (
  workflow_instance_id BIGINT NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_tracking_id VARCHAR(255) NOT NULL,
  definition_key VARCHAR(128) NOT NULL,
  definition_release_id BIGINT NOT NULL,
  workload_type VARCHAR(128) NULL,
  current_stage_key VARCHAR(128) NOT NULL,
  assigned_to VARCHAR(255) NULL,
  branch_key VARCHAR(128) NULL,
  location_key VARCHAR(128) NULL,
  priority VARCHAR(30) NULL,
  received_at DATETIME(6) NULL,
  entered_stage_at DATETIME(6) NOT NULL,
  sla_state VARCHAR(30) NULL,
  receipt_number VARCHAR(255) NULL,
  status VARCHAR(50) NOT NULL,
  row_version BIGINT NOT NULL,
  projected_json JSON NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (workflow_instance_id),
  UNIQUE KEY uq_queue_entity (entity_type, entity_tracking_id),
  KEY ix_queue_stage (current_stage_key, entered_stage_at),
  KEY ix_queue_assignee (assigned_to, current_stage_key),
  KEY ix_queue_scope (branch_key, location_key, current_stage_key),
  KEY ix_queue_definition (definition_key, current_stage_key),
  CONSTRAINT fk_queue_projection_instance
    FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instance (id)
);
