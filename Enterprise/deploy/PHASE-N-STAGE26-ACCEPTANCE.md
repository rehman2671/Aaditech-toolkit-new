# Phase N Stage 26 — Canonical MSI agent and genuine telemetry

**Status: proposed PR; CI and human production acceptance pending.**

The WiX MSI builds canonical `Agent-Collect.ps1`, which formerly sent only
queued `events`. The ingest endpoint accepts events but did not infer top-level
`metrics` or `posture`, so N24/N25 evidence could remain missing even when
the installed worker ran correctly.

Stage N26 probes CPU, RAM and SYSTEM-drive capacity freshly at SEND time, and
collects least-privilege BitLocker, Defender and firewall state. Failed collectors
report NULL/UNKNOWN. It sends real top-level metrics/posture with the existing
tenant-authenticated outbox. Old queued events cannot refresh live measurements.
CPU/RAM/disk alerts now use finite validated measurements (not JavaScript null
coercion). Auxiliary disk and health collectors preserve measured zero vs unknown.

**Acceptance pending:** Node/Vitest, PowerShell AST, real MySQL/API, signed
diagnostic Windows MSI CI plus physical/customer-managed Windows testing.
Real public Authenticode signing, Hostinger VPS/DNS/TLS, offsite production restore,
SMTP inbox/webhook receiver and tenant sign-off remain BLOCKED.
Secure Boot, local administrators and external Graph/Jira providers are
NOT ATTESTED / NOT CONNECTED by this change.
