-- Migration: 001_init_schema.sql
-- Description: Core schema initialization for Aaditech Platform
-- Engine: MySQL 8.0+ / MariaDB 10.4+ (Authoritative Engine)

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- 1. Tenants Table
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

-- 2. Companies Table
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

-- 3. Users Table
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

-- 4. Devices (Endpoints) Table
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

-- 5. Device Running Processes Table
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

-- 6. Device Patches & Updates
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

-- 7. Real Command Queue Table
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

-- 8. MSI Packages Table
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

-- 9. Used Bootstrap Tokens
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

-- 10. Tickets Table
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

-- 11. Events Table
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

-- 12. Remediation Policies & Logs
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

-- 13. Revoked JWT Tokens / JTIs
CREATE TABLE IF NOT EXISTS `revoked_tokens` (
  `token_or_jti` VARCHAR(255) NOT NULL,
  `revoked_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`token_or_jti`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. System Configuration & Integrations Settings
CREATE TABLE IF NOT EXISTS `system_settings` (
  `setting_key` VARCHAR(128) NOT NULL,
  `setting_value` JSON NOT NULL,
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
