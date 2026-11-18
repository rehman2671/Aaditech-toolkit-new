# Phase N Stage 35 — Root-Signed Operator Key Enrollment, Rotation and Revocation

**Status: CODE/CI ACCEPTED — CUSTOMER PRODUCTION BLOCKED (2026-11-18 IST).**

## Verified automation evidence

- [PR #26](https://github.com/rehman2671/Aaditech-toolkit-new/pull/26) squash-merged into main as `c13818e84b7ad8bd28ae3c38fe10ddbee88eac0b`.
- [PR CI #44292807781](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44292807781): **SUCCESS 3/3** — Node/Vitest Stage35 signed registry tests, Windows PowerShell N34/N35 key lifecycle and signed customer-bundle synthetic tests, real isolated MySQL/API. Genuine MSI diagnostic build is intentionally **SKIPPED** for PRs.
- [PR safety #44292807718](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44292807718): **SUCCESS 2/2**.
- [Main CI #44293404866](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44293404866): **SUCCESS 4/4** — Node/Vitest, PowerShell, real MySQL/API and genuine Windows diagnostic ps2exe/WiX MSI build, payload extraction, install/uninstall and major-upgrade retaining enrolled tenant configuration and durable SQLite evidence.
- [Main Windows PowerShell job #134764100242](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44293404866/job/134764100242) logged **"N34/N35 PASS"** for ephemeral Ed25519 root-signed registry issue/verify, independently pinned authority and registry hash/revision, revoked old key, successor-key rotation, stale rollback and positive/negative PowerShell composite bundle evidence tests.
- [Main safety #44293404832](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44293404832): **SUCCESS 2/2**.
- Only **ephemeral CI synthetic root/operator private keys** were used. The Windows publisher-signing flow remained diagnostic and **"Upload verified signed artifacts only" was SKIPPED**. No real operator root key was approved/enrolled/rotated, and no live customer Hostinger or physical Windows replay signoff was performed.



## Why Stage N35

N34 Ed25519 signatures ensure the N32 Windows Offline/Recovered and N33
MySQL receipt report bytes were signed by a given key. A signature plus an
approved public-key fingerprint still does not provide a maintainable,
independently approved key lifecycle. An ex-operator's previously trusted key
could remain accepted unless the customer distributed a current revocation.

N35 adds a separate Ed25519 authority-signed operator key registry. A
customer-controlled external approval channel MUST independently provide the
authority root public-key DER-SPKI SHA256, the exact SHA256 of the current
signed registry JSON **bytes**, and its exact integer revision. The verifier
requires all three. No registry self-approval or download from an untrusted
report can replace these externally approved values.

## Code

- Enterprise/deploy/stage35-operator-registry-core.mjs validates a canonical
  root-signed registry. Each operator entry has a stable opaque key_id,
  public_key_spki_base64, public_key_spki_sha256, purpose fixed to
  SCOPED_MYSQL_RECEIPT_REVIEW, state ACTIVE or REVOKED, UTC validity bounds
  and optional revoked_at_utc. Entries are sorted and unique by key ID and
  key fingerprint. Only Ed25519 keys are allowed; operator key validity
  is capped at two years.
- Registries have a positive integer revision, UTC issued/expires dates
  with **at most 31 days** validity, and an Ed25519 authority signature
  over the deterministic payload. Verification checks exact approved
  registry file SHA256, exact approved revision, approved root key pin,
  validity and signature before examining operator keys.
- The current approved registry controls revocation. A key marked REVOKED
  is rejected **even for older historical signatures**. Expired/not-yet-
  valid operators are rejected; active successor keys verify only when
  included in a current approved higher-revision authority-signed registry.
  This prevents using a previous signed but stale registry as proof under
  the independently approved current revision.
- Enterprise/deploy/stage35-key-registry.mjs supports offline issue from
  a reviewed registry draft using an external protected authority private
  key, and check against original N32/N33 files plus a real N34 attestation.
  It changes no DB, agent, network configuration or service. It does not
  generate any authority or operator private keys.
- Enterprise/tests/New-Stage32CustomerEvidenceBundle.ps1 optionally requires
  OperatorKeyRegistryFile, RegistryAuthorityPublicKeyFile,
  ApprovedRegistryAuthorityPin, ApprovedOperatorRegistrySha256 and
  ApprovedOperatorRegistryRevision **together with N34 signed evidence**.
  It checks registry and operator signature before writing a new immutable
  hash-only composite bundle. It records the approved hash, root pin and
  revision but never changes human_operator_signoff=PENDING,
  server_report_source_authenticated=false or production_certified=false.

## Authorized customer workflow

1. Security administrators independently establish and approve an authority
   root signing key and operator signing keys using the customer's key
   custody/rotation policy. The scripts support protected PEM input, but
   HSM/vault-backed signing, key generation, hardware attestation and
   identity verification are **separate organizational processes**.
2. Review an authority-registry draft stored privately, with JSON object
   fields: schema, revision, issued_at_utc, expires_at_utc, keys.
   Schema: aaditech-stage35-operator-key-registry-payload-v1.
   Each keys entry has exact public key DER SPKI base64 and its full
   lower-case SHA256 pin, key_id, purpose, state, valid_from_utc,
   valid_until_utc and revoked_at_utc (null for ACTIVE).
   Dates use UTC ISO 8601 millisecond precision. Entries are sorted by
   key_id. Start at revision 1, then strictly increment it on updates.
3. An authorized authority signer reviews this private draft and issues
   a NEW signed registry without overwriting prior evidence:

       node Enterprise/deploy/stage35-key-registry.mjs issue --draft /secure/operator-registry-draft.json --authority-private-key /secure/registry-root-private.pem --output /secure/operator-registry-v1.json

   Private PEM must have restrictive permissions (0600 or tighter on Linux).
   An externally provided N35_AUTHORITY_KEY_PASSPHRASE can unlock approved
   encrypted PEM. Never put private keys, passphrases or secrets in Git.
4. The security approver independently validates the current signed registry
   and distributes these trusted values via separate controlled channels:
   approved root DER SPKI SHA256, exact signed registry JSON file SHA256,
   **exact latest approved revision**, and root public PEM. The reviewer must
   not blindly accept fields embedded in the unsigned evidence bundle.
   Keep a protected current-approval record; if revocation is announced,
   replace its approved hash/revision promptly. A stale approval record may
   leave a revoked key accepted until the change is distributed.
5. Following N32 physical offline/reconnect, N33 read-only scoped MySQL
   verification and N34 signed evidence, verify all three source JSON files
   with an approved registry on a different controlled operator host:

       node Enterprise/deploy/stage35-key-registry.mjs check --registry /secure/operator-registry-current.json --authority-public-key /secure/registry-root-public.pem --approved-root-spki-sha256 APPROVED_ROOT_PIN --approved-registry-sha256 APPROVED_REGISTRY_FILE_SHA --approved-revision 1 --offline /secure/n32/stage32-offline.json --recovered /secure/n32/stage32-recovered.json --receipt /secure/n32/stage33-server-receipt.json --attestation /secure/n32/stage34-attestation.json

   A failure prints only a generic code and does not create acceptance
   evidence. Current root-signed key state must be ACTIVE and within its
   validity window. Registry, root and source checks are entirely OFFLINE.
6. On a Windows reviewer machine with installed Node, invoke the existing
   N32 evidence bundler with N34 ServerReceiptReport/OperatorAttestationFile/
   TrustedOperatorPublicKeyFile/ApprovedOperatorKeySha256 options **plus**:

       -OperatorKeyRegistryFile C:\Secure\operator-registry.json -RegistryAuthorityPublicKeyFile C:\Secure\registry-root-public.pem -ApprovedRegistryAuthorityPin APPROVED_ROOT_PIN -ApprovedOperatorRegistrySha256 APPROVED_REGISTRY_FILE_SHA -ApprovedOperatorRegistryRevision 1

   A new redacted composite bundle is written only if both N34 and N35
   verification succeed. This is a cryptographic code-level check, **NOT**
   proof that the customer authorized this particular key-holder, confirmed
   the original network fault or approved live production deployment.

## Emergency revocation and normal rotation

- On suspected key compromise/role removal, the root-authority owner
  immediately issues a **higher revision** with the old operator
  state=REVOKED and an authorized revoked_at_utc. Distribute the new exact
  registry file SHA256 and exact revision through the independent approval
  channel. The check command rejects old signatures under that current
  registry, including those signed before revocation.
- Enroll a successor Ed25519 operator public key in a new higher-revision
  signed registry, using its independently reviewed DER SPKI SHA256. The
  revoked old key stays revoked; a fresh N34 signature under the new
  authorized key is required for evidence acceptance. Never silently
  reattribute the old signature to the successor.
- Root authority key compromise is NOT solved by a registry self-update.
  Freeze verification and independently rotate the **root** public-key
  approval through a separate trusted channel. Existing operator registry
  signatures do not authenticate a newly introduced root by themselves.
- Expired registries fail closed. Only a separately approved current
  registry file hash/revision can prevent rollback; a valid cryptographic
  root signature alone cannot prove that a registry is the most recent one.

## CI and limits

Tests use ephemeral CI-only Ed25519 root and operator keys. They cover
root-signed issue/check, independently pinned root and exact registry hash,
wrong revision, stale replay, tampered root payload, old-key revocation,
new-key rotation, invalid purpose/key and Windows evidence-bundler fail
closed checks. No real customer keys, HSM approvals or production databases
are contacted. Main Windows MSI remains diagnostic only.

- [x] PR Node/Vitest, PowerShell synthetic key lifecycle and isolated MySQL
      integration tests green; deployment safety 2/2.
- [x] Main Node/Vitest, PowerShell, real MySQL/API and diagnostic MSI 4/4
      green; deployment safety 2/2.
- [ ] Independently approved actual root key custody, current registry SHA
      and revision, real customer key revocation/rotation exercise.
- [ ] Physical Windows offline/replay, approved MySQL receipt, public signed
      MSI, real Hostinger TLS and offsite restore, live integrations.

**Never mark real customer production accepted from ephemeral CI keys.**
