-- Slice 18: issued tracking IDs for live intake. Scan looks up workflow_instance.

CREATE TABLE IF NOT EXISTS tracking_id_issuance (
  tracking_id VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  issued_by VARCHAR(255) NULL,
  issued_at DATETIME(6) NOT NULL,
  PRIMARY KEY (tracking_id),
  KEY ix_tracking_issued_at (issued_at)
);
