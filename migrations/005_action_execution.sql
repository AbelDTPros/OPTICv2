-- Slice 8: compatibility transition history and scheduled actions created on stage entry.

CREATE TABLE IF NOT EXISTS workload_transition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  workflow_instance_id BIGINT NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_tracking_id VARCHAR(255) NOT NULL,
  definition_release_id BIGINT NOT NULL,
  from_stage_key VARCHAR(128) NOT NULL,
  to_stage_key VARCHAR(128) NOT NULL,
  action_key VARCHAR(128) NOT NULL,
  stage_visit_id BIGINT NULL,
  actor_id VARCHAR(255) NULL,
  occurred_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_transition_instance (workflow_instance_id, occurred_at),
  CONSTRAINT fk_workload_transition_instance
    FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instance (id)
);

CREATE TABLE IF NOT EXISTS scheduled_workflow_action (
  id BIGINT NOT NULL AUTO_INCREMENT,
  workflow_instance_id BIGINT NOT NULL,
  definition_release_id BIGINT NOT NULL,
  scheduled_action_key VARCHAR(128) NOT NULL,
  stage_visit_id BIGINT NULL,
  due_at DATETIME(6) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  lease_owner VARCHAR(255) NULL,
  lease_expires_at DATETIME(6) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt_at DATETIME(6) NULL,
  last_error_code VARCHAR(100) NULL,
  last_error_message VARCHAR(1000) NULL,
  completed_at DATETIME(6) NULL,
  cancelled_at DATETIME(6) NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_scheduled_idempotency (idempotency_key),
  KEY ix_scheduled_due (status, due_at),
  KEY ix_scheduled_instance (workflow_instance_id, status),
  CONSTRAINT fk_scheduled_action_instance
    FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instance (id)
);
