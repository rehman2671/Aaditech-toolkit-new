-- N28: durable event dedup without changing legacy/null ownership.
-- Nullable IDs preserve old rows; utf8mb4_bin makes the key case-sensitive.
SET @event_key_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'client_msg_id'
);
SET @event_key_sql = IF(@event_key_exists = 0,
  'ALTER TABLE events ADD COLUMN client_msg_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER device_id',
  'SELECT 1'
);
PREPARE event_key_stmt FROM @event_key_sql;
EXECUTE event_key_stmt;
DEALLOCATE PREPARE event_key_stmt;

SET @event_hash_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'event_hash'
);
SET @event_hash_sql = IF(@event_hash_exists = 0,
  'ALTER TABLE events ADD COLUMN event_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER client_msg_id',
  'SELECT 1'
);
PREPARE event_hash_stmt FROM @event_hash_sql;
EXECUTE event_hash_stmt;
DEALLOCATE PREPARE event_hash_stmt;

SET @event_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND INDEX_NAME = 'uq_events_owner_msg'
);
SET @event_index_sql = IF(@event_index_exists = 0,
  'CREATE UNIQUE INDEX uq_events_owner_msg ON events (tenant_id, device_id, client_msg_id)',
  'SELECT 1'
);
PREPARE event_idx_stmt FROM @event_index_sql;
EXECUTE event_idx_stmt;
DEALLOCATE PREPARE event_idx_stmt;
