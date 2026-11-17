-- Stage N25. Historic stored default utilization is untrusted.
-- New enrollment never invents CPU/RAM/disk/battery capacity or health.
SET @metrics_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'devices'
    AND COLUMN_NAME = 'telemetry_reported_at'
);
SET @metrics_col_sql = IF(@metrics_col = 0,
  'ALTER TABLE devices ADD COLUMN telemetry_reported_at DATETIME(3) NULL AFTER disk_free_gb',
  'SELECT 1'
);
PREPARE metrics_col_stmt FROM @metrics_col_sql;
EXECUTE metrics_col_stmt;
DEALLOCATE PREPARE metrics_col_stmt;
ALTER TABLE devices
  MODIFY COLUMN cpu_usage VARCHAR(32) NULL DEFAULT NULL,
  MODIFY COLUMN memory_usage VARCHAR(32) NULL DEFAULT NULL,
  MODIFY COLUMN disk_free VARCHAR(32) NULL DEFAULT NULL,
  MODIFY COLUMN battery VARCHAR(64) NULL DEFAULT NULL,
  MODIFY COLUMN total_ram_gb FLOAT NULL DEFAULT NULL,
  MODIFY COLUMN disk_total_gb FLOAT NULL DEFAULT NULL,
  MODIFY COLUMN disk_free_gb FLOAT NULL DEFAULT NULL;
-- Missing samples are NULL rather than fabricated 0%/0 GB/24ms.
ALTER TABLE telemetry_history
  MODIFY COLUMN cpu_pct FLOAT NULL DEFAULT NULL,
  MODIFY COLUMN ram_pct FLOAT NULL DEFAULT NULL,
  MODIFY COLUMN disk_free_gb FLOAT NULL DEFAULT NULL,
  MODIFY COLUMN net_latency_ms INT NULL DEFAULT NULL;
