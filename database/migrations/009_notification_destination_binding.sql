-- Stage N21: bind each pending notification to the exact approved
-- destination at alert creation without storing the address/URL itself.
-- Historic jobs cannot be safely retroactively attributed to an address:
-- leave them NULL and have the worker skip them (never reroute).
SET @outbox_dest_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_outbox'
    AND COLUMN_NAME = 'destination_hash'
);
SET @outbox_dest_sql = IF(@outbox_dest_exists = 0,
  'ALTER TABLE notification_outbox ADD COLUMN destination_hash CHAR(64) NULL AFTER channel',
  'SELECT 1'
);
PREPARE outbox_dest_stmt FROM @outbox_dest_sql;
EXECUTE outbox_dest_stmt;
DEALLOCATE PREPARE outbox_dest_stmt;
