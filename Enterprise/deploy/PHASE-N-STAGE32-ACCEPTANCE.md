# Phase N Stage 32 — Customer Telemetry Replay Evidence and Operator Workflow

**Status: CODE PROPOSED; CI PENDING; CUSTOMER PRODUCTION BLOCKED.**

## Purpose

Stage N29 introduced immutable SQLite batch payloads and transaction-bound
MySQL receipts. N30 proved pending SQLite survives a genuine Windows MSI
major upgrade. N31 added redacted Windows, Hostinger and signing preflights.
The outstanding gap is defensible **physical customer** evidence that the
enrolled NETWORK SERVICE agent actually retries an interrupted batch and
receives an ACK, without exporting its bearer token, tenant data or telemetry.

This stage introduces two read-only Windows tools, with operator attestations
that are explicitly **not independent network proof**:

- Enterprise/tests/Invoke-Stage32CustomerReplayAcceptance.ps1 observes exactly
  one pending batch and matching pending local event IDs under SQLite read-only
  mode. It writes only batch ID, SHA256 of exact pending JSON, SHA256 of queue
  lifetime identity and event IDs, and local event counts. A second invocation
  on recovery verifies that the exact same body and local row IDs became
  delivered. No raw payload or bearer token is written to evidence.
- Enterprise/tests/New-Stage32CustomerEvidenceBundle.ps1 requires consistent
  offline and recovered reports, checks their SHA256 binding, optionally
  indexes the redacted Stage31 Windows acceptance report, and writes an
  immutable redacted file hash manifest. All customer-production gates
  remain **false/pending** in the report.

Scripts do **not** change network/firewall settings, force scheduled tasks,
write SQLite, enroll a device, contact the API, publish signed MSI, or change
server configuration. Existing N31 customer preflight is used separately.

## Runbook — only after a human-approved maintenance window

1. Install the **independently approved** public signed MSI and complete
   Configure-Agent.ps1 using the actual operator-supplied HTTPS origin and
   single-use enrollment credential. Do not hard-code origin or token in MSI.
   Verify enrollment and scheduled-task identity using Stage31 Windows
   acceptance; keep that JSON in a restricted private evidence directory.
2. As an authorized Windows administrator, prepare a **new** restricted
   directory (for example under ProgramData/ITToolkit-Agent). Do not share
   agent.json, agent.token, agent.identity.json, queue.sqlite3 or logs.
3. With customer approval, manually interrupt the target server's connectivity
   for this device; optionally invoke the preexisting ITToolkitAgent scheduled
   task using normal admin controls. Wait until one pending batch exists.
   **Do not allow scripts to change firewall, hosts file, DNS or network.**
4. During the **observed manual interruption**, run PowerShell:

       .\Enterprise\tests\Invoke-Stage32CustomerReplayAcceptance.ps1 -Phase Offline -EvidenceDirectory C:\Secure\N32Case -OperatorConfirmedOffline

   If there is no intact pending batch, the collector fails. It will not
   manufacture one. Record external interruption evidence separately
   (operator timeline and monitoring) before restoring connectivity.
5. Restore normal connectivity with approval. Let the scheduled task run again.
   Once the original pending batch has a matching server ACK and is marked
   delivered locally, run:

       .\Enterprise\tests\Invoke-Stage32CustomerReplayAcceptance.ps1 -Phase Recovered -EvidenceDirectory C:\Secure\N32Case -OperatorConfirmedReconnect

   If batch ID, queue lifetime UUID, exact JSON digest, local event IDs or
   SQLite delivery state disagree, recovery evidence fails closed. Observe
   promptly; acknowledged batch rows can be pruned after seven days.
6. Create a redacted index of the two observations and optionally the N31
   preflight (which must have been generated earlier):

       .\Enterprise\tests\New-Stage32CustomerEvidenceBundle.ps1 -EvidenceDirectory C:\Secure\N32Case -BundlePath C:\Secure\N32Case\stage32-bundle.json -WindowsPreflightReport C:\Secure\N32Case\stage31-windows.json

   The output is an integrity manifest, not an external attestation. Do not
   upload the private evidence directory to a public release.
7. An **independently authorized** MySQL read-only operator must verify,
   using the actual authenticated tenant/device ownership from the server
   (never guessed), the exact batch ID in the report:

       SELECT COUNT(*) AS receipt_count, MIN(accepted_count) AS acknowledged_events
       FROM telemetry_batches
       WHERE tenant_id = ? AND device_id = ? AND batch_id = ?;

   Require receipt_count=1 and acknowledged_events equal the recorded
   in-flight event count. The local raw HTTP JSON SHA256 is not necessarily
   equal to server request_hash: Node hashes its parsed/re-serialized JSON.
   Do not export tenant/device IDs or server credentials to the redacted
   bundle. This query verifies the single scoped receipt, **not** independently
   every historic telemetry/alert side effect or actual network interruption.
8. Customer change owner separately reviews actual TLS/DNS, approved signing,
   encrypted offsite MySQL restore and live integration deliveries; only a
   human-controlled release checklist can sign off on these external gates.

## Disposable Windows CI diagnostic, deliberately limited

The genuine Windows MSI major-upgrade test stages one pending batch and a
second unrelated pending event in the **real SQLite library installed by MSI**.
It collects N32 Offline evidence, upgrades MSI preserving the immutable queue,
simulates the local post-ACK database state **only in disposable CI**, then
collects Recovered evidence and the redacted SHA256 bundle. This is positive
code/installer coverage but it **does not simulate a real failed HTTPS ACK or
prove a real production server receipt**. N29 real MySQL/API tests retain the
separate server-transaction coverage.

## Acceptance gates

- [ ] PR Node/Vitest, PowerShell negative consent/tampering regressions,
      real MySQL/API, deployment-safety results.
- [ ] Main CI 4/4 including genuine Windows MSI + N32 real SQLite local
      evidence fixture, and deployment-safety 2/2.
- [ ] Physical customer approved interruption and reconnect, local read-only
      N32 evidence, independently confirmed authenticated server receipt.
- [ ] Real signed public MSI, Hostinger deployment/HTTPS/MySQL offsite restore,
      and live SMTP/Graph/ITSM acceptance.

**Never mark customer production certified from synthetic CI or a self-attested
network interruption alone.**
