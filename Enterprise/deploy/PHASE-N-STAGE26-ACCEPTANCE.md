# Phase N Stage 26 — Canonical MSI agent and genuine telemetry

**Status: CODE/CI ACCEPTED — PRODUCTION RELEASE BLOCKED (2026-11-17).**

[PR #16](https://github.com/rehman2671/Aaditech-toolkit-new/pull/16) was squash-merged into main at
`703e8ecbad6f41677f230a6c592eacd694d96d68`.

## Verified automated evidence

- [PR CI #44147826793](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44147826793): **SUCCESS** for Node/Vitest, PowerShell and real MySQL/API. The Windows MSI build job is intentionally **SKIPPED on PRs**.
- [PR deployment safety #44147826527](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44147826527): **SUCCESS 2/2**.
- [Main CI #44148317301](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44148317301): **SUCCESS 4/4** including Windows PowerShell, genuine ps2exe worker, WiX MSI payload extraction, diagnostic install/uninstall and major-upgrade with configuration preservation.
- [Main deployment safety #44148317186](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44148317186): **SUCCESS 2/2**, isolated database backup/restore and recovery.
- Main Windows workflow's **public signed artifact upload was SKIPPED**. Diagnostic MSI is NOT an approved publisher-signed release.

## Defect and change

The canonical WiX MSI compiles `Enterprise/agent/Agent-Collect.ps1`,
which previously sent only queued `events`. The ingest endpoint accepts
events but required distinct authenticated top-level `metrics` and `posture`.
Therefore N24/N25 evidence could remain missing on an operating MSI agent.

N26 collects fresh current CPU, RAM and SYSTEM-drive free disk at batch SEND time
rather than using historical queued events. BitLocker, Defender and firewall
collectors report explicit status or UNKNOWN under existing least-privilege
permissions; they do not assume compliance from enrollment or failed probes.
Verified device-authenticated ingest includes fresh metrics/posture and retains
the old sanitized events. CPU/RAM/disk alert logic now uses bounded finite
measurements; `null <= threshold` cannot fabricate a low-disk alert while
legitimate measured 0 GB can alert. Auxiliary disk and health collectors
also preserve unknown versus measured zero.

## Unmet independent human/production gates

- [ ] On a customer-authorized physical Windows endpoint, install the actual
      canonical MSI, enroll to a real tenant and independently observe the
      server reporting fresh measured values, NULL/UNKNOWN on failures, and
      no stale queue replay counted as live data.
- [ ] Test collector failures under NETWORK SERVICE and real tenant-specific
      notification receipt/approval on customer systems.
- [ ] Obtain authorized public Authenticode certificate/approval, signed MSI
      publisher/timestamp validation and release provenance verification.
- [ ] Obtain approved Hostinger VPS/DNS/TLS acceptance, encrypted production
      database backup with independent offsite restore, live SMTP inbox/webhook
      receiver proof and human deployment sign-off.
- [ ] Secure Boot and local-admin attestation, Microsoft Graph/Intune and
      Jira/ServiceNow/Zendesk real providers require separate integration;
      they are NOT VERIFIED/NOT CONNECTED by Stage N26.

**Decision:** No claim of signed-public-installer readiness, completed customer
deployment, independently attested compliance or production certification.
