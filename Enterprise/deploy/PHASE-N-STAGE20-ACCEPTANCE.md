# Phase N Stage 20 — honest local integrations and ticket secret cleanup

**Status: Code implementation in PR branch; independent CI required. Production certification BLOCKED.**

## No false remote connector acceptance

- The ticket creation API records **local MySQL helpdesk tickets only** and returns `external_sync: NOT_CONNECTED`; it no longer uses a requested provider name as evidence of a Jira/ServiceNow/Zendesk ticket. The portal shows local-only tickets and never claims to push them to an external helpdesk.
- The cloud audit reports accurate **local agent-reported BitLocker/antivirus** metrics, but `configured: false`, `status: NOT_CONNECTED`, no fabricated Azure/Intune/M365 sync, and no fake last_sync timestamp. Adding AZURE_TENANT_ID / GRAPH_CLIENT_ID alone does NOT mean OAuth or Graph verification succeeded.
- When a local ticket references a device hostname, the API requires that device to belong to the authenticated tenant before recording the link.

## Ticket credentials and tenant settings

- The ticket preference API can store only HTTPS provider URL, provider selection and project key. It never accepts or returns API keys; privileged PUT is limited to tenant SUPER_ADMIN.
- Existing historical ticket `api_key` values are dropped from API responses immediately by `getTenantTicketConfig` and deleted in migration `008_scrub_legacy_ticket_keys.sql`. No credentials are transferred to other tenants or audit logs.
- The portal offers no false connection indication and records explicitly that remote integrations remain unimplemented.

## Outstanding real integration acceptance

- Jira/ServiceNow/Zendesk APIs need a separately authorized, private credential/configuration workflow, webhook validation, live response acceptance and retry/error monitoring before they can be marked connected.
- Microsoft Graph requires real OAuth registration/consent/permissions and verified API calls, not simply env variable presence. Cloud/MDM data is **NOT_CONNECTED** until implemented and tested.
- Signed public MSI, live Hostinger VPS/DNS/TLS, real SMTP inbox receipt, approved production MySQL restore and managed Windows UAC/in-place upgrade remain external production gates.
