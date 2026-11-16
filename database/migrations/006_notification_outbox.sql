-- N17: tenant-bound, durable alert outbox.
CREATE TABLE IF NOT EXISTS `notification_outbox` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` VARCHAR(36) NOT NULL,
  `alert_id` BIGINT UNSIGNED NOT NULL,
  `channel` VARCHAR(16) NOT NULL,
  `payload_json` JSON NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lease_token` VARCHAR(36) NULL,
  `lease_expires_at` DATETIME(3) NULL,
  `last_error` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_notification_alert_channel` (`alert_id`, `channel`),
  INDEX `idx_notification_ready` (`status`, `available_at`, `lease_expires_at`),
  INDEX `idx_notification_tenant` (`tenant_id`, `status`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
