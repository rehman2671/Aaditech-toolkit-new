-- Internal report-only assignment. No endpoint execution or diagnostic consent.
-- No inferred ownership, no historical backfill, no automatic reactivation.
CREATE TABLE IF NOT EXISTS troubleshooting_employee_bindings (
  binding_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  employee_user_id INT NOT NULL,
  granted_by INT NOT NULL,
  state ENUM('ACTIVE','REVOKED') NOT NULL,
  revoked_by INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (binding_id),
  UNIQUE KEY uq_employee_device_binding (installation_id,tenant_id,device_id,employee_user_id),
  KEY idx_employee_binding_scope (tenant_id,employee_user_id,state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
