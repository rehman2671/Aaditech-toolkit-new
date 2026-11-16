-- Stage N17: existing remediation_logs rows cannot safely be assigned to tenants by
-- hostname, so keep tenant_id NULL. Authenticated reads require a matching tenant.
SET @tenant_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'remediation_logs'
    AND COLUMN_NAME = 'tenant_id'
);
SET @tenant_add_sql = IF(@tenant_column_exists = 0,
  'ALTER TABLE remediation_logs ADD COLUMN tenant_id VARCHAR(36) NULL AFTER id',
  'SELECT 1'
);
PREPARE tenant_add FROM @tenant_add_sql;
EXECUTE tenant_add;
DEALLOCATE PREPARE tenant_add;

SET @tenant_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'remediation_logs'
    AND INDEX_NAME = 'idx_remediation_logs_tenant_time'
);
SET @tenant_index_sql = IF(@tenant_index_exists = 0,
  'CREATE INDEX idx_remediation_logs_tenant_time ON remediation_logs (tenant_id, executed_at)',
  'SELECT 1'
);
PREPARE tenant_index FROM @tenant_index_sql;
EXECUTE tenant_index;
DEALLOCATE PREPARE tenant_index;
