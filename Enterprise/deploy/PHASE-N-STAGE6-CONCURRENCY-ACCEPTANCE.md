# Phase N Stage 6 — Multi-process tenant identity and bootstrap secrets

**Status: CI-backed hardening complete; NOT PRODUCTION CERTIFIED.**

## Verified MySQL concurrency

[Full CI #43864346207](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43864346207)
passed all four jobs. A new `test-device-identity-concurrency.js` check
runs against the disposable MySQL 8 service. Eight separate Node processes
contended for the same hostname across tenants: **one owner**. Another eight
contended for the same UID: **one owner**. Four unrelated devices succeeded;
MySQL held six distinct claims total. Workers use independent pools and call
the real `db.withDeviceIdentityLock()` plus
`validateEnrollmentIdentity()`. The test uses only the disposable
`itk_ci_identity_claims` table and drops it afterwards. It is gated to
GitHub Actions, `NODE_ENV=test` and
`AADITECH_CONCURRENCY_REHEARSAL=isolated-ci`.

This confirms cross-process database advisory locking, **not** a complete
multi-server HTTP enrollment/registration load test.

## Credential/database hardening

- Production `executeQuery` now rejects in-memory fallback even when an
  obsolete `ALLOW_FALLBACK_DB` environment variable is present.
- Redeemed bootstrap credentials are tracked by **SHA-256 hash only** in
  `used_bootstrap_tokens`; `msi_packages.bootstrap_token` is set to NULL
  after redemption. Invalid/mismatched hashes are rejected.
- Production `getDeviceByTokenHash()` bypasses process-local caches and
  in-memory demo records: **each agent credential is rechecked against MySQL**.
  The shared agent authentication gateway rejects `agent_token_revoked`
  on telemetry as well as command polling. This closes the stale-token
  acceptance window when one Node instance revokes a device that another
  instance previously authenticated. Tests cover revocation, token rotation
  and both agent routes. Real multi-node network outage/fault acceptance is
  still outstanding.
- Historical database rows and backups may still contain earlier secrets.
  After approved backup and change control, check counts without selecting
  plaintext, then scrub **used** records only:

```sql
SELECT COUNT(*) FROM used_bootstrap_tokens WHERE token IS NOT NULL;
SELECT COUNT(*) FROM msi_packages
WHERE used = 1 AND bootstrap_token IS NOT NULL;
START TRANSACTION;
UPDATE used_bootstrap_tokens SET token = NULL WHERE token IS NOT NULL;
UPDATE msi_packages SET bootstrap_token = NULL
WHERE used = 1 AND bootstrap_token IS NOT NULL;
COMMIT;
```

Active unused bootstrap credentials are intentionally untouched.

## Outstanding release gates

Full multi-instance *HTTP* enrollment/registration stress and failure
injection, production tenant-scoped identity storage migration/collision
audit, signing-certificate configuration and trusted MSI artifact,
customer-machine Windows GUI/UAC acceptance, and real Hostinger Docker VPS
HTTPS/MySQL backup-and-restore acceptance. Keep these separate from a
green CI badge; no live production rollout is claimed.
