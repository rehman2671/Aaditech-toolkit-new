# Phase N Stage 15 — Tenant-Bound Alert Evaluation and Webhook Safety

**Status:** Code changes proposed; GitHub CI acceptance must be independently verified after merge. **Production remains BLOCKED.** The prior Stage 14 four-job CI success (run 43933248099) does not certify these new changes.

## Security corrections

- Telemetry evaluates only rules for the *verified device's* actual tenant, and any generated alert carries that same tenant ID. A missing tenant is not converted into the historic global/default tenant in production.
- Automatic alert webhooks no longer consult global retention `slack_webhook_url` / `teams_webhook_url` or global `webhookConfig` records. This prevents other customers' telemetry from being forwarded to platform-wide legacy destinations.
- Each workspace SUPER_ADMIN explicitly configures a separate `tenant:<tenantId>:webhookConfig` record. The integration defaults to **disabled**; no migration auto-enables historic global webhook targets. The existing legacy global configuration remains stored for review and is not a fallback.
- Operators must set `WEBHOOK_ALLOWED_HOSTS` in private `Enterprise/.env` to a comma-separated set of exact public DNS hostnames before any tenant webhook can be saved or delivered. HTTPS is mandatory; plain HTTP, credentials in URL, IP-literal targets, lookalike domains, fragments, unapproved hosts and HTTP redirects are rejected. Delivery uses a five-second timeout.
- Webhook configuration and test routes require the selected tenant's SUPER_ADMIN; the bearer-token form field was removed. The API does not return tenant webhook secrets (none are supported in this implementation).
- The historical 'Send test email' endpoint previously returned `DISPATCHED` despite no SMTP delivery. It now returns explicit HTTP 501 and does **not** claim that an email was sent. Connecting and verifying a real mail service remains a separate requirement.

## Operator rollout and compatibility

1. Before upgrade, record each affected tenant's intended alert recipients, review shared legacy webhook settings and document who may receive event data.
2. Populate the new `WEBHOOK_ALLOWED_HOSTS` property in the **private** environment file on the actual deployment host and redeploy the API. The allowlist is intentionally empty by default, so no webhook traffic is sent until approved.
3. Workspace administrators must open their own workspace and opt in again through the alert webhook settings page; prior global destinations are *not* automatically copied.
4. Validate an approved HTTPS test URL, configure the correct workspace, enable the webhook, and send a test. Confirm only that workspace's endpoint receives its alert data; confirm an unapproved host is refused.
5. Verify actual SMTP before enabling or claiming any email delivery. Use the production backup and recovery procedure if configuration rollback is necessary.

## Verification gates

- Unit regression: `tests/unit/tenant-alert-safety-stage15.test.js` covers per-tenant rule filtering, default-disabled isolation, approved URL behavior, redirect blocking, and missing-tenant alert creation.
- The repository's existing Node/Vitest, HTTP tenant isolation, MySQL fault-injection, workspace invitation, MSI and deployment-safety workflows must remain green.
- These automated checks **do not** establish a signed public MSI release, live Hostinger VPS/DNS/TLS acceptance, physical customer Windows UAC/upgrade acceptance, or production backup/restore rehearsal. Do not report these gates as passed without independent evidence.
