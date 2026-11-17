-- Stage N20: historical API keys were stored under tenant ticket metadata.
-- Remove these secrets without logging or reassigning any workspace setting.
-- No Jira/ServiceNow/Zendesk client currently uses this credential.
UPDATE system_settings
SET setting_value = JSON_REMOVE(setting_value, '$.api_key')
WHERE (setting_key = 'ticketConfig' OR setting_key LIKE 'tenant:%:ticketConfig')
  AND JSON_CONTAINS_PATH(setting_value, 'one', '$.api_key');
