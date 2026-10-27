-- Slice 1: Definition Release persistence.
-- Adds definition tables without removing any legacy business tables.

CREATE TABLE IF NOT EXISTS schema_migration (
  id BIGINT NOT NULL AUTO_INCREMENT,
  filename VARCHAR(255) NOT NULL,
  applied_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_schema_migration_filename (filename)
);

CREATE TABLE IF NOT EXISTS definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  active_release_id BIGINT NULL,
  created_at DATETIME(6) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_definition_key (definition_key)
);

CREATE TABLE IF NOT EXISTS definition_release (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_id BIGINT NOT NULL,
  version VARCHAR(50) NOT NULL,
  lifecycle_status VARCHAR(30) NOT NULL,
  manifest_json JSON NOT NULL,
  canonical_package_json JSON NULL,
  checksum_algorithm VARCHAR(30) NULL,
  checksum VARCHAR(128) NULL,
  created_at DATETIME(6) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  submitted_at DATETIME(6) NULL,
  submitted_by VARCHAR(255) NULL,
  approved_at DATETIME(6) NULL,
  approved_by VARCHAR(255) NULL,
  published_at DATETIME(6) NULL,
  published_by VARCHAR(255) NULL,
  retired_at DATETIME(6) NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_definition_version (definition_id, version),
  KEY ix_definition_lifecycle (definition_id, lifecycle_status),
  CONSTRAINT fk_definition_release_definition
    FOREIGN KEY (definition_id) REFERENCES definition (id)
);

CREATE TABLE IF NOT EXISTS stage_definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_release_id BIGINT NOT NULL,
  stage_key VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stage_key (definition_release_id, stage_key),
  KEY ix_stage_release (definition_release_id),
  CONSTRAINT fk_stage_definition_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);

CREATE TABLE IF NOT EXISTS transition_definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_release_id BIGINT NOT NULL,
  transition_set_key VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transition_set_key (definition_release_id, transition_set_key),
  KEY ix_transition_release (definition_release_id),
  CONSTRAINT fk_transition_definition_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);

CREATE TABLE IF NOT EXISTS form_definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_release_id BIGINT NOT NULL,
  form_key VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_form_key (definition_release_id, form_key),
  KEY ix_form_release (definition_release_id),
  CONSTRAINT fk_form_definition_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);

CREATE TABLE IF NOT EXISTS action_definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_release_id BIGINT NOT NULL,
  action_key VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_action_key (definition_release_id, action_key),
  KEY ix_action_release (definition_release_id),
  CONSTRAINT fk_action_definition_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);

CREATE TABLE IF NOT EXISTS queue_definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_release_id BIGINT NOT NULL,
  queue_key VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_queue_key (definition_release_id, queue_key),
  KEY ix_queue_release (definition_release_id),
  CONSTRAINT fk_queue_definition_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);

CREATE TABLE IF NOT EXISTS bulk_action_definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_release_id BIGINT NOT NULL,
  bulk_action_key VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bulk_action_key (definition_release_id, bulk_action_key),
  KEY ix_bulk_action_release (definition_release_id),
  CONSTRAINT fk_bulk_action_definition_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);

CREATE TABLE IF NOT EXISTS scheduled_action_definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_release_id BIGINT NOT NULL,
  scheduled_action_key VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_scheduled_action_key (definition_release_id, scheduled_action_key),
  KEY ix_scheduled_action_release (definition_release_id),
  CONSTRAINT fk_scheduled_action_definition_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);

CREATE TABLE IF NOT EXISTS sla_definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_release_id BIGINT NOT NULL,
  sla_key VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sla_key (definition_release_id, sla_key),
  KEY ix_sla_release (definition_release_id),
  CONSTRAINT fk_sla_definition_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);

CREATE TABLE IF NOT EXISTS search_definition (
  id BIGINT NOT NULL AUTO_INCREMENT,
  definition_release_id BIGINT NOT NULL,
  search_key VARCHAR(128) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_search_key (definition_release_id, search_key),
  KEY ix_search_release (definition_release_id),
  CONSTRAINT fk_search_definition_release
    FOREIGN KEY (definition_release_id) REFERENCES definition_release (id)
);
