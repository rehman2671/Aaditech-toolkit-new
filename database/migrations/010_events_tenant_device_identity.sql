-- N22: an event hostname is NOT a tenant/device identity. Historic events
-- lack a trusted device ID: leave ownership NULL rather than guessing from
-- duplicate hostnames across workspaces. Tenant APIs must ignore NULL rows.
SET @evt_tenant_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'tenant_id'
);
SET @evt_tenant_sql = IF(@evt_tenant_exists = 0,
  'ALTER TABLE events ADD COLUMN tenant_id VARCHAR(36) NULL AFTER id', 'SELECT 1'
);
PREPARE evt_tenant_stmt FROM @evt_tenant_sql;
EXECUTE evt_tenant_stmt;
DEALLOCATE PREPARE evt_tenant_stmt;

SET @evt_device_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'device_id'
);
SET @evt_device_sql = IF(@evt_device_exists = 0,
  'ALTER TABLE events ADD COLUMN device_id VARCHAR(64) NULL AFTER tenant_id', 'SELECT 1'
);
PREPARE evt_device_stmt FROM @evt_device_sql;
EXECUTE evt_device_stmt;
DEALLOCATE PREPARE evt_device_stmt;

SET @evt_owner_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events'
    AND INDEX_NAME = 'idx_events_owner_time'
);
SET @evt_owner_index_sql = IF(@evt_owner_index_exists = 0,
  'CREATE INDEX idx_events_owner_time ON events (tenant_id, device_id, captured_at)',
  'SELECT 1'
);
PREPARE evt_owner_stmt FROM @evt_owner_index_sql;
EXECUTE evt_owner_stmt;
DEALLOCATE PREPARE evt_owner_stmt;
