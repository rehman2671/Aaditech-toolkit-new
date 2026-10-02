-- Aaditech Endpoint Enterprise Platform
-- Complete MySQL Schema for Hostinger Shared Hosting (MySQL 8.0 / MariaDB 10.4+)
-- Authoritative Single Source of Truth

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- --------------------------------------------------------
-- 0. Schema Migrations Tracking Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `execution_time_ms` INT NOT NULL DEFAULT 0,
  `checksum` VARCHAR(64) NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 1. Tenants Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tenants` (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `slug` VARCHAR(64) NOT NULL UNIQUE,
  `plan` VARCHAR(32) DEFAULT 'enterprise',
  `status` VARCHAR(32) DEFAULT 'active',
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 2. Companies Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `companies` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `name` VARCHAR(128) NOT NULL,
  `users_count` INT DEFAULT 0,
  `agents_count` INT DEFAULT 0,
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_companies_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 3. Users Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `company_id` INT DEFAULT 1,
  `username` VARCHAR(64) NOT NULL UNIQUE,
  `email` VARCHAR(128) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) DEFAULT 'OPERATOR',
  `active` BOOLEAN DEFAULT TRUE,
  `status` VARCHAR(32) DEFAULT 'ACTIVE',
  `last_login` DATETIME(3) NULL,
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_users_tenant` (`tenant_id`),
  INDEX `idx_users_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 4. Devices (Endpoints) Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `devices` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `company_id` INT DEFAULT 1,
  `hostname` VARCHAR(128) NOT NULL,
  `device_uid` VARCHAR(128) NULL,
  `os_version` VARCHAR(128) DEFAULT 'Windows 11 Pro',
  `os_build` VARCHAR(64) DEFAULT '22631.3007',
  `arch` VARCHAR(32) DEFAULT 'x64',
  `ip_address` VARCHAR(64) DEFAULT '127.0.0.1',
  `mac_address` VARCHAR(64) NULL,
  `status` VARCHAR(32) DEFAULT 'ONLINE',
  `cpu_model` VARCHAR(128) NULL,
  `cpu_cores` INT DEFAULT 4,
  `cpu_usage` VARCHAR(32) DEFAULT '15%',
  `memory_usage` VARCHAR(32) DEFAULT '45%',
  `disk_free` VARCHAR(32) DEFAULT '250 GB',
  `battery` VARCHAR(64) DEFAULT '100% (AC)',
  `total_ram_gb` FLOAT DEFAULT 16.0,
  `disk_total_gb` FLOAT DEFAULT 512.0,
  `disk_free_gb` FLOAT DEFAULT 256.0,
  `bitlocker_status` VARCHAR(32) DEFAULT 'PROTECTED',
  `antivirus_name` VARCHAR(128) DEFAULT 'Windows Defender',
  `antivirus_status` VARCHAR(32) DEFAULT 'ACTIVE',
  `firewall_status` VARCHAR(32) DEFAULT 'ENABLED',
  `security_score` INT DEFAULT 95,
  `agent_version` VARCHAR(32) DEFAULT '1.1.2',
  `auth_token_hash` VARCHAR(128) NULL,
  `device_token_hash` VARCHAR(128) NULL,
  `device_token_prefix` VARCHAR(32) NULL,
  `agent_token_revoked` BOOLEAN DEFAULT FALSE,
  `last_seen_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `registered_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_devices_tenant` (`tenant_id`),
  INDEX `idx_devices_status` (`status`),
  INDEX `idx_devices_last_seen` (`last_seen_at`),
  INDEX `idx_devices_hostname` (`hostname`),
  INDEX `idx_devices_uid` (`device_uid`),
  INDEX `idx_devices_token_hash` (`device_token_hash`),
  INDEX `idx_devices_auth_token_hash` (`auth_token_hash`),
  INDEX `idx_devices_tenant_status` (`tenant_id`, `status`),
  INDEX `idx_devices_tenant_hostname` (`tenant_id`, `hostname`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 5. Telemetry History (Time-Series Metrics)
-- --------------------------------------------------------
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

-- --------------------------------------------------------
-- 6. Device Running Processes Table (Live Process Snapshot)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `device_processes` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `device_id` VARCHAR(64) NOT NULL,
  `pid` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `cpu_pct` FLOAT DEFAULT 0.0,
  `ram_mb` FLOAT DEFAULT 0.0,
  `path` VARCHAR(500) NULL,
  `user_account` VARCHAR(128) NULL,
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_proc_device` (`device_id`),
  INDEX `idx_proc_dev_cpu` (`device_id`, `cpu_pct`),
  INDEX `idx_proc_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 7. Device Patches & Updates
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `device_patches` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `device_id` VARCHAR(64) NOT NULL,
  `kb_id` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `severity` VARCHAR(32) DEFAULT 'Important',
  `status` VARCHAR(32) DEFAULT 'MISSING',
  `installed_at` DATETIME(3) NULL,
  `detected_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_patch_device` (`device_id`),
  INDEX `idx_patch_kb` (`kb_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 8. Real Command Queue Table (Asynchronous Dispatch & Execution)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `command_queue` (
  `id` VARCHAR(64) NOT NULL,
  `device_id` VARCHAR(64) NOT NULL,
  `hostname` VARCHAR(128) NULL,
  `command_type` VARCHAR(64) NOT NULL,
  `payload` JSON NULL,
  `hmac_signature` VARCHAR(128) NULL,
  `signed_content` TEXT NULL,
  `status` VARCHAR(32) DEFAULT 'PENDING',
  `dispatched_by` VARCHAR(64) DEFAULT 'SYSTEM',
  `dispatched_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `picked_up_at` DATETIME(3) NULL,
  `executed_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `stdout` MEDIUMTEXT NULL,
  `stderr` MEDIUMTEXT NULL,
  `exit_code` INT DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_cmd_device_status` (`device_id`, `status`),
  INDEX `idx_cmd_dev_status_disp` (`device_id`, `status`, `dispatched_at`),
  INDEX `idx_cmd_dispatched` (`dispatched_at`),
  INDEX `idx_cmd_hostname_status` (`hostname`, `status`),
  INDEX `idx_cmd_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 9. Audit Logs Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `actor_id` VARCHAR(64) NULL,
  `actor_email` VARCHAR(128) NULL,
  `actor` VARCHAR(128) NOT NULL,
  `action` VARCHAR(128) NOT NULL,
  `target_resource` VARCHAR(255) NOT NULL,
  `details` JSON NULL,
  `ip_address` VARCHAR(64) NULL,
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_audit_tenant_time` (`tenant_id`, `created_at`),
  INDEX `idx_audit_actor` (`actor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 10. Alert Rules Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `alert_rules` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `name` VARCHAR(128) NOT NULL,
  `description` TEXT NULL,
  `metric` VARCHAR(64) NOT NULL,
  `condition_op` VARCHAR(8) NOT NULL DEFAULT '>=',
  `threshold` FLOAT NOT NULL,
  `duration_mins` INT DEFAULT 5,
  `severity` VARCHAR(32) NOT NULL DEFAULT 'warning',
  `enabled` BOOLEAN DEFAULT TRUE,
  `condition_json` JSON NULL,
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_rules_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 11. Triggered Alerts Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `alerts` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `device_id` VARCHAR(64) NOT NULL,
  `agent_id` INT NULL,
  `hostname` VARCHAR(128) NOT NULL,
  `rule` VARCHAR(128) NULL,
  `rule_name` VARCHAR(128) NOT NULL,
  `severity` VARCHAR(32) NOT NULL DEFAULT 'warning',
  `message` TEXT NOT NULL,
  `status` VARCHAR(32) DEFAULT 'open',
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `resolved_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_alerts_status` (`status`),
  INDEX `idx_alerts_device` (`device_id`),
  INDEX `idx_alerts_dev_status` (`device_id`, `status`),
  INDEX `idx_alerts_tenant_created` (`tenant_id`, `created_at`),
  INDEX `idx_alerts_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 12. Groups Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `groups` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `name` VARCHAR(128) NOT NULL,
  `description` TEXT NULL,
  `member_count` INT DEFAULT 0,
  `policy_id` VARCHAR(64) NULL,
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_groups_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 13. Policies Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `policies` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `name` VARCHAR(128) NOT NULL,
  `checkin_interval_sec` INT DEFAULT 30,
  `auto_update` BOOLEAN DEFAULT TRUE,
  `maintenance_mode` BOOLEAN DEFAULT FALSE,
  `data_retention_days` INT DEFAULT 90,
  `config` JSON NULL,
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_policies_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 14. MSI Packages Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `msi_packages` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `package_name` VARCHAR(128) NOT NULL,
  `version` VARCHAR(32) NOT NULL,
  `bootstrap_token` TEXT NULL,
  `bootstrap_token_hash` VARCHAR(128) NULL,
  `token_expires_at` DATETIME(3) NOT NULL,
  `used` BOOLEAN DEFAULT FALSE,
  `used_at` DATETIME(3) NULL,
  `used_by_device` VARCHAR(128) NULL,
  `created_by` VARCHAR(64) NULL,
  `file_path` VARCHAR(255) NULL,
  `download_url` VARCHAR(255) NULL,
  `file_hash_sha256` VARCHAR(128) NULL,
  `downloads_count` INT DEFAULT 0,
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_msi_tenant` (`tenant_id`),
  INDEX `idx_msi_hash` (`bootstrap_token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 15. Used Bootstrap Tokens (Single-Use Token Tracking)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `used_bootstrap_tokens` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `token_hash` VARCHAR(128) NOT NULL UNIQUE,
  `token` TEXT NULL,
  `device_hostname` VARCHAR(128) NULL,
  `tenant_id` VARCHAR(36) NULL,
  `used_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_used_bt_hash` (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 16. Tickets Table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tickets` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  `system` VARCHAR(64) DEFAULT 'Jira',
  `title` VARCHAR(255) NOT NULL,
  `status` VARCHAR(32) DEFAULT 'Open',
  `severity` VARCHAR(32) DEFAULT 'Medium',
  `agent` VARCHAR(128) NULL,
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_tickets_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 17. Events (Telemetry Batches & Diagnostic Events)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `events` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `hostname` VARCHAR(128) NOT NULL,
  `kind` VARCHAR(64) NOT NULL,
  `sanitized` BOOLEAN DEFAULT TRUE,
  `payload` JSON NULL,
  `captured_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_events_host_kind` (`hostname`, `kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 18. Remediation Policies & Execution Logs
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `remediation_policies` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `description` TEXT NULL,
  `enabled` BOOLEAN DEFAULT TRUE,
  `trigger_condition` VARCHAR(255) NULL,
  `action_type` VARCHAR(64) NOT NULL,
  `executions_count` INT DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `idx_remediation_action` (`action_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `remediation_logs` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `hostname` VARCHAR(128) NOT NULL,
  `policy_name` VARCHAR(128) NOT NULL,
  `action` VARCHAR(255) NOT NULL,
  `status` VARCHAR(32) DEFAULT 'success',
  `executed_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 19. Revoked JWT Tokens / JTIs (Cross-Process Revocation)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `revoked_tokens` (
  `token_or_jti` VARCHAR(255) NOT NULL,
  `revoked_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`token_or_jti`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 20. System Configuration & Integrations Settings
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `system_settings` (
  `setting_key` VARCHAR(128) NOT NULL,
  `setting_value` JSON NOT NULL,
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Default Tenants, Companies, Users, Alert Rules, Policies
INSERT IGNORE INTO `tenants` (`id`, `name`, `slug`, `plan`, `status`)
VALUES ('00000000-0000-0000-0000-000000000001', 'Aaditech Enterprise Corp', 'aaditech-corp', 'enterprise', 'active');

INSERT IGNORE INTO `companies` (`id`, `tenant_id`, `name`, `users_count`, `agents_count`)
VALUES (1, '00000000-0000-0000-0000-000000000001', 'Aaditech Enterprise', 3, 3);

INSERT IGNORE INTO `users` (`id`, `tenant_id`, `company_id`, `username`, `email`, `password_hash`, `role`, `active`, `status`)
VALUES 
(1, '00000000-0000-0000-0000-000000000001', 1, 'admin', 'admin@aaditech.com', '$2b$10$TdjPGYqvBhQ/znxrISK4leR0Q7x4QAQW2ZGzOCAx.YK35eHrbROmW', 'SUPER_ADMIN', 1, 'ACTIVE'),
(2, '00000000-0000-0000-0000-000000000001', 1, 'ops_lead', 'ops@aaditech.com', '$2b$10$tL4nJuWXUzt/0GCKKGBdYONSEz3DaUwJY/CjeNyFSymTjnLsG3tTu', 'OPERATOR', 1, 'ACTIVE'),
(3, '00000000-0000-0000-0000-000000000001', 1, 'sec_monitor', 'monitor@aaditech.com', '$2b$10$NsbjYaSfny5cA4RBHXyw5OtEBfolN57DqRLAzNv2rpA22laPAd1Fe', 'MONITORING', 1, 'ACTIVE');

INSERT IGNORE INTO `alert_rules` (`id`, `tenant_id`, `name`, `description`, `metric`, `condition_op`, `threshold`, `duration_mins`, `severity`, `enabled`)
VALUES 
('rule-1', '00000000-0000-0000-0000-000000000001', 'High CPU Sustained (>85%)', 'Alert when CPU exceeds 85% sustained load', 'cpu', '>=', 85.0, 5, 'critical', 1),
('rule-2', '00000000-0000-0000-0000-000000000001', 'Low System Disk Space (<15 GB)', 'Alert when free space falls below 15 GB', 'disk', '<=', 15.0, 1, 'warning', 1),
('rule-3', '00000000-0000-0000-0000-000000000001', 'Agent Missed Heartbeat (>10 mins)', 'Alert when agent is offline', 'heartbeat', '>=', 10.0, 10, 'critical', 1),
('rule-4', '00000000-0000-0000-0000-000000000001', 'High RAM Memory Load (>90%)', 'Alert when RAM usage exceeds 90%', 'ram', '>=', 90.0, 15, 'warning', 1);

INSERT IGNORE INTO `groups` (`id`, `tenant_id`, `name`, `description`, `member_count`, `policy_id`)
VALUES 
('grp-1', '00000000-0000-0000-0000-000000000001', 'Engineering Laptops', 'High performance developer devices', 8, 'pol-1'),
('grp-2', '00000000-0000-0000-0000-000000000001', 'Finance & Operations', 'Secure workstation group for accounting', 5, 'pol-2'),
('grp-3', '00000000-0000-0000-0000-000000000001', 'Executive Fleet', 'VIP devices with priority monitoring', 3, 'pol-1');

INSERT IGNORE INTO `policies` (`id`, `tenant_id`, `name`, `checkin_interval_sec`, `auto_update`, `maintenance_mode`, `data_retention_days`)
VALUES 
('pol-1', '00000000-0000-0000-0000-000000000001', 'Standard Enterprise Telemetry', 30, 1, 0, 90),
('pol-2', '00000000-0000-0000-0000-000000000001', 'High-Security PCI Compliance Policy', 15, 1, 0, 365);

INSERT IGNORE INTO `remediation_policies` (`id`, `name`, `description`, `enabled`, `trigger_condition`, `action_type`, `executions_count`)
VALUES 
('clean_temp', 'Auto Disk Space Remediation', 'Automatically cleans Windows Temp, Update Caching & DISM Store when disk free space falls below threshold', 1, 'disk_free < 20GB', 'clean_temp_files', 14),
('restart_spooler', 'Print Spooler Self-Healing', 'Restarts Print Spooler service and flushes stuck print jobs if spooler crashes or hangs', 1, 'spooler_status == stopped', 'restart_spooler', 8),
('reset_network', 'Network Adapter & DNS Auto-Reset', 'Flushes DNS cache, resets Winsock catalog and renews DHCP lease when Internet reachability drops', 1, 'ping_gateway_failed', 'reset_network', 5),
('clear_bits', 'BITS Queue Auto-Flush', 'Clears stuck Background Intelligent Transfer Service jobs when Windows Update locks up', 0, 'bits_stuck_jobs > 5', 'clear_bits', 2);

INSERT IGNORE INTO `devices` (`id`, `tenant_id`, `company_id`, `hostname`, `device_uid`, `os_version`, `arch`, `ip_address`, `status`, `cpu_usage`, `memory_usage`, `disk_free`, `battery`, `bitlocker_status`, `antivirus_name`, `antivirus_status`, `firewall_status`, `last_seen_at`)
VALUES 
('1', '00000000-0000-0000-0000-000000000001', 1, 'DESKTOP-CORP-01', 'dev-uid-desktop-corp-01', 'Windows 11 Pro', 'x64', '192.168.1.101', 'ONLINE', 12.5, 45.2, 120.4, 100, 'ENCRYPTED', 'Windows Defender', 'ACTIVE', 'ACTIVE', NOW(3)),
('2', '00000000-0000-0000-0000-000000000001', 1, 'SRV-FINANCE-02', 'dev-uid-srv-finance-02', 'Windows Server 2022', 'x64', '192.168.1.20', 'ONLINE', 28.0, 62.1, 450.8, 100, 'ENCRYPTED', 'Windows Defender', 'ACTIVE', 'ACTIVE', NOW(3)),
('3', '00000000-0000-0000-0000-000000000001', 1, 'LAPTOP-EXEC-03', 'dev-uid-laptop-exec-03', 'Windows 11 Pro', 'x64', '192.168.1.155', 'ONLINE', 8.2, 38.4, 85.0, 92, 'ENCRYPTED', 'Windows Defender', 'ACTIVE', 'ACTIVE', NOW(3));

SET FOREIGN_KEY_CHECKS = 1;
