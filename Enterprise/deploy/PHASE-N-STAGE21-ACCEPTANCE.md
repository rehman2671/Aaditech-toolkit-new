# Phase N Stage 21 — Destination-bound outbox and truthful lease acknowledgements

**Implementation PR: pending independent CI and merge; production NOT CERTIFIED.**

## Privacy problem closed
- Stage17 notification jobs were inserted at alert time only for enabled channels, but the worker previously consulted **latest** email recipient / webhook URL. Changing the recipient after alert creation could silently leak old queued event data to the new target.
- Stage21 stores a secret-keyed `destination_hash` derived from tenant identity, channel and exact endpoint **at alert creation**. Actual destination strings remain in tenant settings, not the outbox. The worker rechecks enabled consent, domain/host approval, and constant-time fingerprint equality immediately before transmission.
- Historic queued records without a trusted binding remain NULL in migration `009_notification_destination_binding.sql` and are skipped, never retroactively delivered. This trade-off can drop unbound pending notifications but prevents unauthorized export.
- Endpoint/path/query-token and recipient changes invalidate pending jobs, including changes after temporary disable/reenable. HMAC secret rotation likewise invalidates pending jobs; operators must plan rotations.

## Reliability corrections
- Outbox 90-second lease expanded to 300 seconds. A 20-job batch processes max five at once and SMTP sender timeout can reach 30 seconds; the former lease could expire during normal operation.
- Delivery counters increment only if MySQL confirms the corresponding lease-token-guarded completion/retry update. Lost or stolen leases are counted as `lostLease`, not confirmed successes.
- SQL-backed atomic alert+job insertion remains required on production; channel jobs with missing/malformed destination binding are refused before the alert transaction.

## Acceptance and open gates
- Run Node/Vitest, real MySQL 8/API and fault-injection suite, DB recovery, PowerShell, diagnostic Windows MSI rehearsal, and verify the results on merged main before closing Stage21 acceptance.
- Customer SMTP inbox, signed public MSI, live Hostinger VPS/DNS/TLS, actual production DB migration/restore, and physical managed Windows UAC/upgrade remain operator/production gates.
