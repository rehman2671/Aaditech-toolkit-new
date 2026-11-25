-- Explicit local operator binding; no auto-population or adoption.
CREATE TABLE IF NOT EXISTS installation_database_identity (
  singleton_id TINYINT UNSIGNED NOT NULL,
  installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bound_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (singleton_id),
  CONSTRAINT ck_installation_database_singleton CHECK (singleton_id=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
