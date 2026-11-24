# Local read-only operations — Phase O reference

Status: implementation on review PR #113, not a production installer or remote agent integration. Run from the repository on a trusted local host. These commands do not authorize remediation or installation. Never supply a remote/network-mounted filesystem or use untrusted local directories. Diagnostic output is not independent proof of measurement truth.

## Diagnostics

Examples on a Linux host (replace the path/interface with an operator-selected local value):

```sh
node scripts/local-diagnostic-cli.mjs resource --target /var --sample-ms 250 --confirm-local-read-only
node scripts/local-diagnostic-cli.mjs disk --target /var --confirm-local-read-only
node scripts/local-diagnostic-cli.mjs network --interface eth0 --confirm-local-read-only
```

Output is JSON with the canonical artifact, its SHA-256, measured-field count and explicit non-authorization flags. No active network probe is sent; network observation is Linux selected-interface IPv4 only. Disk available percentage is available blocks / total blocks, not physical disk health. SMART health and mount writability are null until independently supported. Missing observations are null, not fabricated zero. Errors produce exit 1 and no artifact. No automatic remote upload or signing.

## Combined LAN preflight

Prepare a trusted local JSON document with these exact keys. Replace all placeholders with actual local absolute paths, externally approved public pins and the real public key. Do not put credentials or private keys in this document.

```json
{
  "bundle": {
    "manifest": "/approved/manifest.json",
    "root": "/approved/payload",
    "signature": "/approved/manifest.sig",
    "trustedManifestSha256": "REPLACE_WITH_APPROVED_64_HEX_DIGEST",
    "trustedPublicKeyPem": "REPLACE_WITH_APPROVED_PUBLIC_KEY_PEM",
    "trustedSignerSpkiSha256": "REPLACE_WITH_APPROVED_64_HEX_PIN"
  },
  "host": {
    "targetDirectory": "/var",
    "markerPaths": {
      "database": "/var/lib/aaditech/database",
      "credentials": "/var/lib/aaditech/credentials",
      "service": "/var/lib/aaditech/service"
    },
    "ports": [443],
    "minCpu": 2,
    "minMemoryBytes": 4294967296,
    "minFreeBytes": 10737418240
  }
}
```

Resource thresholds and marker paths above are examples, not an approved host policy. Use independently reviewed deployment topology and thresholds.

```sh
node scripts/local-lan-preflight-cli.mjs --confirm-local-read-only < local-preflight.json
```

Exit 0: no observed blockers; external review still required. Exit 2: categorical blockers reported. Exit 1: input or verification refused; no successful report. A missing marker does not prove absence of a database, service or credentials. No port reservation, TLS provisioning, runtime compatibility approval, secret provisioning or installation is performed. No public network fallback. Never treat this command as a green installation gate.

## Acceptance still required

Fresh exact-head CI and independent reconciliation, owner ADRs, approved runtime package, local TLS and secret provisioning, durable setup, browser bootstrap, physical disconnected LAN installation, trusted endpoint collection, consent and actual incident attempt lifecycle.

## Local setup continuity and artifact retention (2026-11-25)

The programmatic `inspectLocalSetupContinuity` reference combines the exact independently pinned setup journal with a freshly verified signed release and host observations. A pending step requires operator reconciliation; fresh-host blockers are separate and cannot authorize resume. `retainLocalDiagnosticArtifact` and `readRetainedLocalDiagnosticArtifact` provide explicit local POSIX-only content-addressed custody, requiring a trusted absolute 0700 directory, canonical bounded artifact bytes and the expected digest. Files are 0600, published exclusively and synced; duplicate writes are rejected. Readback verifies bytes and refuses tampering and unsafe permissions. No CLI persistence option, remote upload, signature issuance, diagnostic attempt acceptance, automatic deletion, or production authorization. These references do not provide hostile same-UID or whole-directory rollback protection. Six new regression cases across both modules; fresh CI required.

## Explicit local diagnostic custody and setup continuity commands (2026-11-25)

For an existing trusted private POSIX directory (0700), explicitly consent to both read-only collection and local retention:

```sh
node scripts/local-diagnostic-custody-cli.mjs collect --directory /private/artifacts --confirm-local-retention -- disk --target /var --confirm-local-read-only
node scripts/local-diagnostic-custody-cli.mjs read --directory /private/artifacts --sha256 APPROVED_64_HEX_DIGEST --confirm-local-read-only
```

Collection returns a digest and retention receipt, not the artifact itself. Readback validates the independently supplied digest and canonical bytes; no signature or measurement truth is established. Duplicate retention is refused. No automatic cleanup, remote upload or attempt acceptance.

For local setup continuity, extend the existing preflight JSON configuration with an `anchor` object having exactly `directory`, `installationId`, `releaseSha256`, `checkpointBase64`, `signatureBase64`, `signerPublicKeyPem`, `expectedSignerSpkiSha256`, and `expectedCheckpointSha256`. Use canonical base64 for the signed checkpoint bytes and detached Ed25519 signature, independent current pins and an absolute journal directory. Do not take these pins from an untrusted checkpoint or browser request.

```sh
node scripts/local-setup-continuity-cli.mjs --confirm-local-read-only < local-continuity.json
```

Exit 2 means interruption or fresh-host blockers; exit 1 refusal; exit 0 no observed blockers, never permission to resume. No mutation, install, browser route or automatic replay. Fresh CI and independent review required.

## Operator input ambiguity hardening (2026-11-25)

2026-11-25 — PR #113 operator input hardening: both local LAN readiness and setup continuity JSON stdin entry points reuse the existing signed-bundle duplicate-key and 64-level nesting guard after fatal UTF-8 decoding and JSON syntax validation. Duplicate decoded keys (including escaped aliases), ambiguous nested inputs and excessive depth refuse before host/journal inspection. Existing read-only confirmation, byte bounds, redacted errors and exit-code semantics retained. Regression cases added; fresh exact-head CI and independent review pending. No installer/resume authorization, owner ADR, main merge or production acceptance.
