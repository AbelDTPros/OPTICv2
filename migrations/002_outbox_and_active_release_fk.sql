-- Slice 1 close-out: transactional outbox for configuration events,
-- and the circular FK from definition.active_release_id to definition_release.

CREATE TABLE IF NOT EXISTS outbox_event (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_version INT NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  correlation_id VARCHAR(128) NOT NULL,
  session_id VARCHAR(128) NULL,
  actor_id VARCHAR(255) NULL,
  payload_json JSON NOT NULL,
  publish_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  publish_attempts INT NOT NULL DEFAULT 0,
  published_at DATETIME(6) NULL,
  last_error VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_outbox_event_id (event_id),
  KEY ix_outbox_publish (publish_status, id),
  KEY ix_outbox_aggregate (aggregate_type, aggregate_id, occurred_at)
);

SET @fk_exists := (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'definition'
     AND CONSTRAINT_NAME = 'fk_definition_active_release'
);

SET @ddl := IF(
  @fk_exists = 0,
  'ALTER TABLE definition ADD CONSTRAINT fk_definition_active_release FOREIGN KEY (active_release_id) REFERENCES definition_release (id)',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
