-- N29: create durable, atomic per-authenticated-device telemetry batch receipt.
CREATE TABLE IF NOT EXISTS `telemetry_batches` (
  `tenant_id` VARCHAR(36) NOT NULL,
  `device_id` VARCHAR(64) NOT NULL,
  `batch_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `request_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `insert_nonce` CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `accepted_count` INT NOT NULL,
  `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `device_id`, `batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
