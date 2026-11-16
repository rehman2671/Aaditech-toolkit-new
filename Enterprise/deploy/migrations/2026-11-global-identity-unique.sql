-- Stage 8: OPTIONAL, manually approved global identity index migration.
-- Never auto-run. Quiesce enrollment and registration on ALL API nodes.
-- Require encrypted backup + tested restore and clean read-only preflight.
-- MySQL DDL implicitly commits; use an approved maintenance window.
-- This preserves CURRENT GLOBAL ownership (not per-tenant UID reuse).
ALTER TABLE devices
  ADD UNIQUE KEY uq_devices_global_hostname (hostname),
  ADD UNIQUE KEY uq_devices_global_uid (device_uid);
