-- Slice 7/8 close-out: replayable mutation keys for assign, release, draft, and actions.

CREATE TABLE IF NOT EXISTS idempotency_record (
  id BIGINT NOT NULL AUTO_INCREMENT,
  actor_id VARCHAR(255) NOT NULL,
  operation VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_idempotency (actor_id, operation, idempotency_key)
);
