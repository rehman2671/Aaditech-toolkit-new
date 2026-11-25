-- Immutable technician assessment of previously unknown intake hazards.
-- No alteration of intake, execution permission or verification of safety.
CREATE TABLE IF NOT EXISTS troubleshooting_hazard_assessments (
 incident_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 assessment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 tenant_id VARCHAR(36) NOT NULL,
 device_id VARCHAR(64) NOT NULL,
 actor_user_id INT NOT NULL,
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 assessment ENUM('NONE','PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE') NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (incident_id),
 UNIQUE KEY uq_hazard_assessment_id (assessment_id),
 UNIQUE KEY uq_hazard_assessment_request (installation_id,tenant_id,actor_user_id,request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
