-- Slice 13: configurable ATOMIC / BEST_EFFORT bulk operations.

CREATE TABLE IF NOT EXISTS bulk_operation (
  id BIGINT NOT NULL AUTO_INCREMENT,
  bulk_action_key VARCHAR(128) NOT NULL,
  definition_release_id BIGINT NOT NULL,
  initiated_by VARCHAR(255) NOT NULL,
  session_id VARCHAR(128) NOT NULL,
  correlation_id VARCHAR(128) NOT NULL,
  transaction_mode VARCHAR(30) NOT NULL,
  input_json JSON NOT NULL,
  status VARCHAR(30) NOT NULL,
  total_items INT NOT NULL,
  successful_items INT NOT NULL DEFAULT 0,
  failed_items INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY ix_bulk_operation_release (definition_release_id),
  KEY ix_bulk_operation_correlation (correlation_id),
  CONSTRAINT fk_bulk_operation_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);

CREATE TABLE IF NOT EXISTS bulk_operation_item (
  id BIGINT NOT NULL AUTO_INCREMENT,
  bulk_operation_id BIGINT NOT NULL,
  workflow_instance_id BIGINT NOT NULL,
  entity_tracking_id VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL,
  error_code VARCHAR(100) NULL,
  error_message VARCHAR(1000) NULL,
  completed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bulk_item (bulk_operation_id, workflow_instance_id),
  KEY ix_bulk_item_operation (bulk_operation_id),
  CONSTRAINT fk_bulk_item_operation
    FOREIGN KEY (bulk_operation_id) REFERENCES bulk_operation (id)
);
