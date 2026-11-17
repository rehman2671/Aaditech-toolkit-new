-- Stage N19: remove historical plaintext GitHub PAT from system settings.
-- This migration never copies the token to an audit log, release config or
-- another field. New GitHub Actions credentials are provided via server env only.
UPDATE system_settings
SET setting_value = JSON_REMOVE(setting_value, '$.github_token')
WHERE setting_key = 'branding'
  AND JSON_CONTAINS_PATH(setting_value, 'one', '$.github_token');
