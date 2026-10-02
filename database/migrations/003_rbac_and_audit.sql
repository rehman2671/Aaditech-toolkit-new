-- Migration: 003_rbac_and_audit.sql
-- Description: RBAC, Audit Logging, Alerting & System Seed Configuration
-- Engine: MySQL 8.0+ / MariaDB 10.4+ (Authoritative Engine)

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Audit Logs Table
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

-- 2. Alert Rules Table
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

-- 3. Triggered Alerts Table
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

-- 4. Groups Table
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

-- 5. Policies Table
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

-- 6. Idempotent Baseline Seeds
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
