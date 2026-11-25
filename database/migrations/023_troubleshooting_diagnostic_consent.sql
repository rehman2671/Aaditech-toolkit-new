-- Employee diagnostic review consent, separate from intake and execution.
CREATE TABLE IF NOT EXISTS troubleshooting_diagnostic_consent (
 consent_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 tenant_id VARCHAR(36) NOT NULL,
 device_id VARCHAR(64) NOT NULL,
 incident_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 employee_user_id INT NOT NULL,
 requester_id INT NOT NULL,
 diagnostic_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 state ENUM('REQUESTED','GRANTED','DENIED','REVOKED') NOT NULL,
 revision INT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 expires_at DATETIME(3) NOT NULL,
 PRIMARY KEY (consent_id),
 UNIQUE KEY uq_diagnostic_consent_incident (incident_id),
 KEY idx_diagnostic_consent_scope (installation_id,tenant_id,employee_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS troubleshooting_diagnostic_consent_events (
 event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 consent_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 actor_user_id INT NOT NULL,
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 action ENUM('REQUEST','GRANT','DENY','REVOKE') NOT NULL,
 revision INT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (event_id),
 UNIQUE KEY uq_consent_request (consent_id,request_id),
 UNIQUE KEY uq_consent_revision (consent_id,revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
