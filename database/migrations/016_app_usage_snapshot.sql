-- Phase O: one bounded, credential-bound app-usage snapshot per device.
-- Existing Redis data is not imported: its provenance cannot be established.
CREATE TABLE IF NOT EXISTS device_app_usage_snapshots (
  device_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  credential_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_json JSON NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (device_id),
  INDEX idx_app_usage_tenant (tenant_id, recorded_at),
  CONSTRAINT fk_app_usage_snapshot_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
