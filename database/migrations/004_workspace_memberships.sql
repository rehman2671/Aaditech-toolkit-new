-- Phase N Stage 13: explicit, operator-approved membership for multi-workspace access.
-- Primary workspace still comes from users.tenant_id; additional tenants require
-- an ACTIVE membership and current MySQL revalidation on every JWT request.
CREATE TABLE IF NOT EXISTS `user_workspace_memberships` (
  `user_id` INT NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'MONITORING',
  `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  `granted_by` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`, `tenant_id`),
  INDEX `idx_workspace_tenant_status` (`tenant_id`, `status`),
  INDEX `idx_workspace_user_status` (`user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing primary workspaces remain valid; seed a descriptive membership.
-- Do not overwrite explicitly revoked records.
INSERT IGNORE INTO `user_workspace_memberships`
  (`user_id`, `tenant_id`, `role`, `status`, `granted_by`)
SELECT `id`, `tenant_id`, `role`, 'ACTIVE', NULL
FROM `users` WHERE `tenant_id` IS NOT NULL;
