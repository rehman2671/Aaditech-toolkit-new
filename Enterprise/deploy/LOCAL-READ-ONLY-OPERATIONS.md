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

2026-11-25 — #113 CI 45493407981 on 59fc7928 failed to import the signed-LAN regression suite because of a missing fixture-call closing parenthesis introduced in the previous test edit. 566 other tests and PowerShell validation passed; API and both MSI jobs skipped. Corrected the fixture syntax without changing the duplicate-key/depth rejection or weakening assertions. Fresh CI required; no production acceptance.

## Offline employee advisory guide (2026-11-25)

```sh
node scripts/local-troubleshooting-guide.mjs --html > local-troubleshooting-guide.html
node scripts/local-troubleshooting-guide.mjs --category TR-01 --hazard UNKNOWN
```

Open the generated HTML locally in a browser. It contains 26 disclosure cards and an upfront hazard warning, no scripts, remote assets, forms or device collection. Routine card instructions apply only when no hazard is suspected; the JSON CLI defaults to refusal of invalid/missing hazard values and applies hazard-specific advice. This is advisory reference only, not an authenticated employee portal, intake or repair. Use the organization's approved IT support channel. The internal scoped planned-only lookup does not expose any HTTP endpoint or authorize execution.

## Verified troubleshooting integration and local battery reference (2026-11-25)

2026-11-25 — integrate verified #113 exact head 0bf585e0 (CI 45496444877: 1,234/1,234 Vitest, including 161 register tests, statements 71.23%; PowerShell and API/MySQL passed; both MSI jobs skipped). Extend local-only battery diagnostic: selected BAT-number Linux sysfs source, bounded reads, presence/type verification, categorical charge status, same-unit full/design capacity ratio, unknown on invalid or unavailable observations; CLI, signed review compatibility and explicitly selected private artifact custody. No arbitrary command, path, device scan, serial or remote execution. Added 77 battery regression cases and one signed-review compatibility case, updated existing CLI/register fixtures. One existing Linux battery task advances from pending to partial reference only; register remains 158 unique IDs (42 source implemented pending combined CI, 8 partial reference, 108 pending, zero accepted). Physical battery evidence, other OS collectors, consent, actual attempt, independent acceptance and production signing remain pending. No migration or release authorization. Fresh combined exact-head CI and safety required.

Local read-only example: `node scripts/local-diagnostic-cli.mjs battery --battery BAT0 --confirm-local-read-only`. Only an explicit BAT-number selector is supported. Unknown observations are null; no physical battery or health certification is implied. For optional retention, use the existing private POSIX directory custody CLI with `--confirm-local-retention -- battery --battery BAT0 --confirm-local-read-only` and the required `--directory` option. Do not use unreviewed remote execution or infer repair authorization.

## Passive Linux power and Bluetooth diagnostic references (2026-11-25)

2026-11-25 — Exact #109 be99085b CI #45560632311 completed successfully: 1,475/1,475 Vitest (71.19% statements, existing 70% gate), PowerShell, real API/MySQL including N29 recovery causality and bounded intake, unsigned Windows MSI lifecycle; protected signing skipped. Deployment safety #45560632368 succeeded. Add Linux passive power-profile and selected Bluetooth rfkill diagnostic references: fixed bounded kernel scalar reads, no arbitrary paths/commands, observation consistency and directory identity checks, explicit local CLI confirmation, canonical redacted output, existing signed review contracts and optional private POSIX artifact retention. Power profile derives only from the known kernel platform_profile vocabulary; sleep policy unmeasured. Bluetooth OFF denotes observed kernel soft/hard RF block, NOT independently verified controller power; unblocked, missing or malformed evidence remains unknown, service state unmeasured. Two existing Linux collector records move to PARTIAL_REFERENCE_ONLY; 158 IDs retained (42 source implemented pending combined CI, 10 partial, 106 pending, zero accepted). Added 66 focused collector/custody cases and one signed-review compatibility case. No employee-to-device identity binding, consent lifecycle, actual remote collector, authorized repair, physical endpoint certification, production signing or acceptance. Fresh exact-head CI required.

Read-only local examples (Linux; missing observations remain null):

```sh
node scripts/local-diagnostic-cli.mjs power --confirm-local-read-only
node scripts/local-diagnostic-cli.mjs bluetooth --radio rfkill0 --confirm-local-read-only
```

Select a known local rfkill index; do not scan or mutate radios. Kernel RF blocking does not establish controller power or service health. The existing private-directory custody CLI accepts these collector options with its separate explicit retention confirmation. No remote invocation or operational acceptance is implied.

## Explicit offline release staging (2026-11-25)

This operation **writes** a private local copy, unlike read-only preflight. Use an existing trusted Linux directory with mode 0700. Provide bounded JSON via stdin with exactly `destinationParent` and `bundle` (`root`, `manifest`, `signature`, `trustedManifestSha256`, `trustedPublicKeyPem`, `trustedSignerSpkiSha256`). All paths absolute, pins independently approved. Source and destination must be separate, trusted local storage.

```sh
node scripts/stage-offline-lan-bundle-cli.mjs --confirm-local-staging < staging-input.json
```

Successful output identifies a unique private staging directory, manifest digest and verified file count. 64 GiB reference cap and capacity check; no runtime import or execution. Ordinary failures clean the unique stage; crash remnants need operator reconciliation. Do not launch staged bytes on the basis of this receipt. No protection against hostile same-UID writers, no physical offline acceptance. Fresh CI required. Seven Windows read-only providers from #116 are also carried forward; both PowerShell versions passed 166 checks at that prior head, not this new head.
