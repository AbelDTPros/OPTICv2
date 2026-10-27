-- Slice 4: common workflow runtime instance and stage-visit history.
-- Domain Mail/Workload tables remain separate; this table points at the entity.

CREATE TABLE IF NOT EXISTS workflow_instance (
  id BIGINT NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(50) NOT NULL,
  entity_tracking_id VARCHAR(255) NOT NULL,
  definition_release_id BIGINT NOT NULL,
  current_stage_definition_id BIGINT NOT NULL,
  current_stage_key VARCHAR(128) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  assigned_to VARCHAR(255) NULL,
  entered_stage_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workflow_entity (entity_type, entity_tracking_id),
  KEY ix_workflow_stage (definition_release_id, current_stage_key, status),
  KEY ix_workflow_assignee (assigned_to, status),
  KEY ix_workflow_entered_stage (current_stage_key, entered_stage_at),
  CONSTRAINT fk_workflow_instance_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id),
  CONSTRAINT fk_workflow_instance_stage
    FOREIGN KEY (current_stage_definition_id) REFERENCES stage_definition (id)
);

CREATE TABLE IF NOT EXISTS workflow_stage_visit (
  id BIGINT NOT NULL AUTO_INCREMENT,
  workflow_instance_id BIGINT NOT NULL,
  stage_definition_id BIGINT NOT NULL,
  stage_key VARCHAR(128) NOT NULL,
  visit_number INT NOT NULL,
  entered_at DATETIME(6) NOT NULL,
  entered_by VARCHAR(255) NULL,
  assigned_at DATETIME(6) NULL,
  assigned_to VARCHAR(255) NULL,
  processing_started_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  completed_by VARCHAR(255) NULL,
  exit_action_key VARCHAR(128) NULL,
  next_stage_key VARCHAR(128) NULL,
  duration_seconds BIGINT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stage_visit (workflow_instance_id, stage_key, visit_number),
  KEY ix_stage_visit_open (workflow_instance_id, completed_at),
  KEY ix_stage_visit_sla (stage_key, entered_at, completed_at),
  CONSTRAINT fk_stage_visit_instance
    FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instance (id),
  CONSTRAINT fk_stage_visit_stage
    FOREIGN KEY (stage_definition_id) REFERENCES stage_definition (id)
);
