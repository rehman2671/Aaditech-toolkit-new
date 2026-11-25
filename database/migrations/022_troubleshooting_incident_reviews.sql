-- Separate human review lifecycle; never overwrite intake status or assert resolution.
CREATE TABLE IF NOT EXISTS troubleshooting_incident_reviews (
  incident_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  review_state ENUM('IN_REVIEW','AWAITING_USER','REFERRED','REOPENED') NOT NULL,
  revision INT UNSIGNED NOT NULL,
  reviewer_id INT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (incident_id),
  KEY idx_incident_review_scope (installation_id,tenant_id,device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS troubleshooting_incident_review_events (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  incident_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  actor_user_id INT NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_state ENUM('UNREVIEWED','IN_REVIEW','AWAITING_USER','REFERRED','REOPENED') NOT NULL,
  next_state ENUM('IN_REVIEW','AWAITING_USER','REFERRED','REOPENED') NOT NULL,
  revision INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_incident_review_request (incident_id,request_id),
  UNIQUE KEY uq_incident_review_revision (incident_id,revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
