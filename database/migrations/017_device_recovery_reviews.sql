-- Phase O review-only recovery reservations. Not an activation grant.
-- Retain review tombstones; do not cascade them on device deletion.
CREATE TABLE IF NOT EXISTS device_recovery_reviews (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  requester_id INT NOT NULL,
  reviewer_id INT NULL,
  challenge_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  credential_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  evidence_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewer_spki_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  state ENUM('PENDING','REVIEW_RESERVED') NOT NULL DEFAULT 'PENDING',
  created_at_ms BIGINT UNSIGNED NOT NULL,
  expires_at_ms BIGINT UNSIGNED NOT NULL,
  reviewed_at_ms BIGINT UNSIGNED NULL,
  review_expires_at_ms BIGINT UNSIGNED NULL,
  PRIMARY KEY (request_id),
  UNIQUE KEY uq_recovery_challenge (challenge_sha256),
  UNIQUE KEY uq_recovery_evidence (evidence_sha256),
  KEY idx_recovery_device (tenant_id,device_id,expires_at_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
