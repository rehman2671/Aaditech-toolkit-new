-- N24: record trusted transport provenance separately from legacy stored
-- defaults. Never assume historical PROTECTED/ACTIVE scores were reported by
-- an actual agent. Old rows retain NULL posture_reported_at.
SET @posture_col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'devices'
    AND COLUMN_NAME = 'posture_reported_at'
);
SET @posture_col_sql = IF(@posture_col_exists = 0,
  'ALTER TABLE devices ADD COLUMN posture_reported_at DATETIME(3) NULL AFTER security_score',
  'SELECT 1'
);
PREPARE posture_col_stmt FROM @posture_col_sql;
EXECUTE posture_col_stmt;
DEALLOCATE PREPARE posture_col_stmt;

-- Fresh installs and new enrollments must not inherit invented health state.
-- Historic stored values are preserved for incident review but not trusted by
-- posture endpoints until verified-device telemetry sets the provenance field.
ALTER TABLE devices
  MODIFY COLUMN bitlocker_status VARCHAR(32) NULL DEFAULT NULL,
  MODIFY COLUMN antivirus_name VARCHAR(128) NULL DEFAULT NULL,
  MODIFY COLUMN antivirus_status VARCHAR(32) NULL DEFAULT NULL,
  MODIFY COLUMN firewall_status VARCHAR(32) NULL DEFAULT NULL,
  MODIFY COLUMN security_score INT NULL DEFAULT NULL;
