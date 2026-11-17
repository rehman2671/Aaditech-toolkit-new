-- N30: efficiently find old orphan receipts while keeping live-owner keys indefinitely.
-- Fresh schema already has this index; existing installs apply it conditionally.
SET @receipt_age_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'telemetry_batches'
    AND INDEX_NAME = 'idx_telemetry_batches_age'
);
SET @receipt_age_index_sql = IF(@receipt_age_index_exists = 0,
  'CREATE INDEX idx_telemetry_batches_age ON telemetry_batches (recorded_at, tenant_id)',
  'SELECT 1'
);
PREPARE receipt_age_index_stmt FROM @receipt_age_index_sql;
EXECUTE receipt_age_index_stmt;
DEALLOCATE PREPARE receipt_age_index_stmt;
