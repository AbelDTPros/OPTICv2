-- Separate Try rehearsal cases from Live queue projections.
-- Rehearsal instances stay in workflow_instance for Try, but never appear in Live queues.
-- Idempotent: safe if a prior attempt added the column/index before failing on cleanup SQL.

SET @has_rehearsal := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'workflow_instance'
     AND COLUMN_NAME = 'rehearsal'
);
SET @sql := IF(
  @has_rehearsal = 0,
  'ALTER TABLE workflow_instance ADD COLUMN rehearsal TINYINT(1) NOT NULL DEFAULT 0 AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'workflow_instance'
     AND INDEX_NAME = 'ix_workflow_rehearsal_release'
);
SET @sql := IF(
  @has_idx = 0,
  'ALTER TABLE workflow_instance ADD KEY ix_workflow_rehearsal_release (definition_release_id, rehearsal)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Existing I-936 Try leakage: hide from Live and drop any projections.
UPDATE workflow_instance wi
  INNER JOIN definition_release dr ON dr.id = wi.definition_release_id
  INNER JOIN definition d ON d.id = dr.definition_id
   SET wi.rehearsal = 1
 WHERE d.definition_key LIKE 'I_936%';

DELETE p
  FROM workflow_queue_projection p
 WHERE p.definition_key LIKE 'I_936%';
