# Phase N Stage 33 — Independent MySQL Receipt Verification and Operator Review

**Status: CODE PROPOSED; PR/main CI PENDING; CUSTOMER PRODUCTION BLOCKED.**

## Motivation

Stage N32 created read-only, redacted local SQLite evidence for a pending
telemetry batch and subsequent local ACK. These observations cannot independently
prove that the expected tenant/device was accepted by MySQL. N33 adds a
second observer with its own operator-supplied MySQL access. No unfinalized
production endpoints, credentials or signing approvals are assumed.

## Implementation and trust limits

The Node.js verifier Enterprise/deploy/verify-stage33-server-receipt.mjs
checks the original N32 Offline and Recovered report bytes, matching case run ID,
batch ID, queue identity and raw payload SHA256, local delivery state, event
counts, false production flags and operator-provided tenant/device binding.
It opens a MySQL START TRANSACTION READ ONLY transaction and performs one
parameterized SELECT from telemetry_batches scoped to tenant_id, device_id
and batch_id. There must be precisely one committed receipt with the expected
accepted_count and valid server hash. Missing, changed or out-of-scope rows
fail closed, and no report is created.

Credentials come only from DB_* environment variables or a protected Unix
socket, not CLI arguments, logs, git or generated reports. Nonloopback TCP
requires DB_SSL_CA_FILE for verified TLS. On Linux the private scope binding
identity file must be mode 0600. The output is immutable, mode 0600, and
contains a report fingerprint, batch ID, original report file hashes and
accepted event count but no tenant/device IDs, bearer token, raw HTTP body,
DB password or raw server request hash.

The N32 bundler accepts optional -ServerReceiptReport and checks the MySQL
report's local file hashes, run/batch IDs, payload digest and count. Because
a portable JSON report is NOT cryptographically signed, it records
SCOPED_MYSQL_REPORT_MATCHED_OPERATOR_SIGNOFF_PENDING and never claims that
the source has been authenticated, that network packet loss was measured or
that customer production acceptance is complete.

The local N32 payload hash is over exact original Windows JSON bytes. Server
request_hash is calculated over JSON.stringify(parsed request body), so they
can legitimately differ. N33 never pretends to prove raw-byte identity.
Server receipt attests transaction key/count, not externally delivered
email/webhooks or independent observed HTTP ACK-loss.

## Customer operation after authorization

1. First complete the N32 physical Windows offline/reconnect procedure
   and collect Stage32 Offline and Recovered redacted JSON files, plus
   separately witnessed network interruption and restoration evidence.
2. Independently establish the enrolled tenant UUID and device ID from
   the authorized customer inventory, and prepare a private Linux JSON file
   identity-private.json with fields case_run_id (N32 run_id), tenant_id and
   device_id. chmod 600 the file. Never publish these identifiers as
   part of the output bundle.
3. An authorized DBA provisions a dedicated SELECT-only MySQL account,
   scoped to telemetry_batches, without any data/schema write permissions.
   Use a secure vault to set DB_HOST, DB_PORT, DB_NAME, DB_USER and
   DB_PASSWORD in process environment; set DB_SSL_CA_FILE for remote MySQL
   or DB_SOCKET_PATH for a local protected socket. Never shell-trace secrets.
4. From a private checkout with Node.js dependencies installed run:

       node Enterprise/deploy/verify-stage33-server-receipt.mjs --evidence-dir /secure/n32 --identity-file /secure/identity-private.json --output /secure/n32/stage33-server-receipt.json

   A mismatch returns a generic redacted error code; it never creates a
   successful output report. The verifier does not update data or APIs.
5. Give the protected Stage33 server report to the independent customer
   reviewer, then on Windows run:

       .\Enterprise\tests\New-Stage32CustomerEvidenceBundle.ps1 -EvidenceDirectory C:\Secure\N32Case -BundlePath C:\Secure\N32Case\stage33-reviewed-bundle.json -ServerReceiptReport C:\Secure\N32Case\stage33-server-receipt.json

   The resulting SHA256 manifest links the evidence but **does not
   authenticate its producer**. Verify the DB operator identity, provenance,
   logs and approval out of band before customer acceptance.
6. Independently sign off the real Hostinger HTTPS/DNS/TLS, approved public
   Authenticode signed MSI, customer encrypted offsite restore, physical
   NETWORK SERVICE replay and live email/webhook/Graph/ITSM integrations.

## Disposable CI evidence scope

Vitest tests check signature/owner/count invariants and fail-closed outcomes.
A disposable MySQL 8 rehearsal seeds temporary rows with a test-only writer,
then calls the production **read-only** verifier to check the receipt, wrong
tenant, wrong device, altered local JSON, wrong event count and missing receipt.
PowerShell bundler tests validate that the optional server report cannot
manufacture customer certification. No actual customer DB or credentials are
used. Main Windows MSI diagnostic upgrade remains a separate gate.

## Gates

- [ ] PR CI Node/Vitest, PowerShell and real isolated MySQL/API green;
      deployment safety 2/2 green.
- [ ] Main CI 4/4 including genuine Windows diagnostic MSI and safety 2/2.
- [ ] Actual customer Windows operator-observed network interruption and
      recovery plus independently authenticated read-only MySQL receipt.
- [ ] Approved public signed MSI, production Hostinger VPS/DNS/TLS, encrypted
      offsite restore and real external integrations independently accepted.

**Never equate CODE/CI verification or unsigned JSON with production signoff.**
