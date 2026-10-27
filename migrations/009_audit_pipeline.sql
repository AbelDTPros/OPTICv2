-- Slice 12: authoritative audit store, Splunk-safe projection, and per-consumer outbox delivery.
-- Application API accounts MUST NOT receive UPDATE or DELETE on audit_event (append-only).
-- Local Docker uses a single `optic` user; enforce the privilege split in non-local environments.

CREATE TABLE IF NOT EXISTS audit_event (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  actor_id VARCHAR(255) NULL,
  actor_name VARCHAR(255) NULL,
  session_id VARCHAR(128) NULL,
  correlation_id VARCHAR(128) NOT NULL,
  source_service VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NULL,
  entity_tracking_id VARCHAR(255) NULL,
  definition_key VARCHAR(128) NULL,
  definition_version VARCHAR(50) NULL,
  stage_key VARCHAR(128) NULL,
  action_key VARCHAR(128) NULL,
  event_data_json JSON NOT NULL,
  previous_hash VARCHAR(128) NULL,
  event_hash VARCHAR(128) NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_audit_event_id (event_id),
  KEY ix_audit_entity (entity_type, entity_tracking_id, occurred_at),
  KEY ix_audit_correlation (correlation_id),
  KEY ix_audit_actor (actor_id, occurred_at)
);

CREATE TABLE IF NOT EXISTS audit_hash_cursor (
  partition_key VARCHAR(255) NOT NULL,
  last_event_id CHAR(36) NULL,
  last_event_hash VARCHAR(128) NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (partition_key)
);

CREATE TABLE IF NOT EXISTS outbox_delivery (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  consumer_key VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL,
  lease_owner VARCHAR(128) NULL,
  lease_expires_at DATETIME(6) NULL,
  last_error VARCHAR(1000) NULL,
  published_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_outbox_delivery (event_id, consumer_key),
  KEY ix_outbox_delivery_claim (consumer_key, status, next_attempt_at, id),
  CONSTRAINT fk_outbox_delivery_event FOREIGN KEY (event_id) REFERENCES outbox_event (event_id)
);

CREATE TABLE IF NOT EXISTS splunk_event (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  correlation_id VARCHAR(128) NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_splunk_event_id (event_id),
  KEY ix_splunk_correlation (correlation_id)
);
