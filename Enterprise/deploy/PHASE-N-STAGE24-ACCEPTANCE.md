# Phase N Stage 24 — Evidence-backed, fail-closed endpoint security posture

**Status: STAGE 24 CODE/CI ACCEPTED; PRODUCTION RELEASE BLOCKED.** [PR #14](https://github.com/rehman2671/Aaditech-toolkit-new/pull/14) merged. [Main CI #44065258102](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258102) **SUCCESS 4/4**, including diagnostic real Windows MSI install/uninstall/major-upgrade; [main safety #44065258073](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258073) **SUCCESS 2/2**. No public signed MSI, customer Hostinger deployment or independent cloud attestation claimed.

## Audited defect

Previously `GET /api/v1/security/posture` returned `secure_boot: true`, `local_admins_count: 2`, antivirus ACTIVE, BitLocker protected, firewall ENABLED and score 95 as *defaults* even for freshly enrolled devices that had not sent security telemetry. The database and registration SQL also initialized fictitious healthy values. `/api/v1/compliance/cloud-audit` treated these stored defaults as current local device compliance evidence.

The Windows PowerShell agent's `Get-SecurityPosture` routine started with BitLocker PROTECTED and antivirus ACTIVE and preserved these values when collectors failed; its security score was then derived from that optimistic input. These are compliance-misrepresentation hazards, not proof of a secure host.

## Stage24 implementation

- Migration `011_security_posture_provenance.sql` adds nullable `devices.posture_reported_at` and clears healthy **column defaults** for new devices. No existing historical records are assigned evidence timestamps; ambiguous old data remains unverified.
- Enrollment no longer seeds healthy status or scores. On re-enrollment/upsert a missing status cannot overwrite a previous explicit observation; it also cannot manufacture freshness.
- Only an authenticated device's telemetry ingestion writes `posture_reported_at` (server-owned time). Each posture payload is one snapshot: missing fields clear prior values instead of laundering legacy defaults into measured health.
- The device security API reports `UNVERIFIED`, `STALE`, or `AGENT_REPORTED`; evidence expires after 24h. Unknown and stale values produce `null` metrics, never compliant booleans or perfect scores.
- `secure_boot` and `local_admins_count` remain `null` until real collectors exist. Security scores require complete, known BitLocker, antivirus and firewall evidence. A valid reported score of 0 must be preserved.
- Cloud audit remains `configured:false`, `NOT_CONNECTED`, with no Graph claims. Local metric percentages are `N/A` if no fresh measured denominator, and report coverage counts.
- Windows `Get-SecurityPosture` now uses UNKNOWN on BitLocker/Defender/Firewall failures. Defender ACTIVE requires confirmed `Get-MpComputerStatus` real-time protection state; firewall enabled requires all returned profiles enabled; no score unless all three evidence fields are known.

## Acceptance and remaining gates

- PR/main Node/Vitest and PowerShell parsers, real MySQL/API network fault injection, isolated migration/recovery, Windows MSI diagnostic install/uninstall/major-upgrade and documentation sync are required before declaring Stage24 code/CI accepted.
- Local enrolled-agent reporting is not independent MDM/Graph attestation. Public Authenticode signed MSI, live Hostinger VPS/DNS/TLS, authorized production DB offsite restore, customer SMTP inbox/webhook receiver and physical managed Windows remain separately **BLOCKED**.

## Verified Stage24 CI evidence (2026-11-17)

- [PR CI #44064858994](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44064858994) SUCCESS and [PR deployment-safety #44064859054](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44064859054) SUCCESS before squash merge.
- PR #14 merged at `eaa2a7b8e6665542e2ad6b6bb3e6e3cc2c0a817a`.
- [Main CI #44065258102](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258102) SUCCESS **4/4**: Node/Vitest, PowerShell agent parser/validation, isolated MySQL/API fault injection, diagnostic Windows WiX MSI install/uninstall/major-upgrade with tenant configuration preserved.
- [Main safety #44065258073](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258073) SUCCESS **2/2**: Bash offline recovery controls, real isolated MySQL backup-and-restore rehearsal.
- These disposable CI checks do NOT certify public Authenticode signing, physical customer Windows, actual Hostinger DNS/TLS/VPS, customer DB offsite restore, SMTP inbox receipt or third-party Microsoft Graph integration.
