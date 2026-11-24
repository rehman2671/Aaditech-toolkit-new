-- Internal diagnostic planning records only; NOT executed attempts.
CREATE TABLE IF NOT EXISTS troubleshooting_diagnostic_plans (
  plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  incident_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  actor_user_id INT NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  diagnostic_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (plan_id),
  UNIQUE KEY uq_diagnostic_plan_request (incident_id,request_id),
  KEY idx_diagnostic_plan_scope (installation_id,tenant_id,device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
