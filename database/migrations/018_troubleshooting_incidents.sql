-- M4 internal technician intake foundation; no employee intake, consent,
-- diagnosis, attempt execution, repair or resolution is authorized here.
CREATE TABLE IF NOT EXISTS troubleshooting_incidents (
  incident_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  actor_user_id INT NOT NULL,
  intake_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_id CHAR(5) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hazard ENUM('UNKNOWN','NONE','PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE') NOT NULL,
  status ENUM('OPEN','ESCALATED') NOT NULL,
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (incident_id),
  UNIQUE KEY uq_incident_intake (installation_id,tenant_id,actor_user_id,intake_request_id),
  KEY idx_incident_scope (installation_id,tenant_id,device_id,opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
