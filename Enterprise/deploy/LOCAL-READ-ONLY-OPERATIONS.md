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
