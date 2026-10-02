-- Migration: 002_partitioning.sql
-- Description: MySQL-native Range Partitioning for high-volume time-series telemetry_history
-- Engine: MySQL 8.0+ / MariaDB 10.4+ (Authoritative Engine)

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `telemetry_history` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `device_id` VARCHAR(64) NOT NULL,
  `cpu_pct` FLOAT NOT NULL,
  `ram_pct` FLOAT NOT NULL,
  `disk_free_gb` FLOAT NOT NULL,
  `net_latency_ms` INT DEFAULT 24,
  `network_bytes_in` BIGINT DEFAULT 0,
  `network_bytes_out` BIGINT DEFAULT 0,
  `metrics_json` JSON NULL,
  `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`, `recorded_at`),
  INDEX `idx_telemetry_device_time` (`device_id`, `recorded_at`),
  INDEX `idx_telemetry_recorded_at` (`recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(recorded_at)) (
  PARTITION p_historical VALUES LESS THAN (TO_DAYS('2026-08-01')),
  PARTITION p_2026_08 VALUES LESS THAN (TO_DAYS('2026-09-01')),
  PARTITION p_2026_09 VALUES LESS THAN (TO_DAYS('2026-10-01')),
  PARTITION p_2026_10 VALUES LESS THAN (TO_DAYS('2026-11-01')),
  PARTITION p_2026_11 VALUES LESS THAN (TO_DAYS('2026-12-01')),
  PARTITION p_2026_12 VALUES LESS THAN (TO_DAYS('2027-01-01')),
  PARTITION p_future VALUES LESS THAN MAXVALUE
);

SET FOREIGN_KEY_CHECKS = 1;
