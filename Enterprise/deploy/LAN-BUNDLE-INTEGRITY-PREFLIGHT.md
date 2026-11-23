# LAN-01: Read-only, offline payload integrity preflight

**Status: IMPLEMENTED AS A STANDALONE BUILD/OPERATIONS PREREQUISITE ONLY.**
This script is **not** an installer, signer, operating-system preflight, production-attested release or approved runtime. Do not advertise a working disconnected-office install or merge this code without independent review.

The Node.js 20+ command below verifies an offline payload directory and manifest **without performing any network access, installation, execution or write to the payload**:

```sh
node scripts/verify-lan-bundle.mjs \
  --manifest /trusted-transfer/manifest.json \
  --root /trusted-transfer/payload \
  --trusted-manifest-sha256 64_HEX_SHA256_FROM_INDEPENDENT_TRUSTED_RELEASE_CHANNEL
```

The `--trusted-manifest-sha256` value **MUST** be distributed out of band in an independently authenticated, owner-approved release record. **Never copy the value from the same untrusted archive as its manifest**, because an attacker can replace both files and checksums.

## Manifest schema v1 (illustrative only)

```json
{
  "schema_version": 1,
  "installation_mode": "intranet",
  "files": [
    {
      "path": "images/backend.tar",
      "size": 1234,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
}
```

The manifest is a JSON file **outside** the payload directory. Every payload file must appear once, with a safe portable relative path, exact byte size, and SHA-256 checksum. The verifier rejects duplicate/case-colliding paths, path traversal, symlinks, missing files, extra files, mismatched sizes and hashes, invalid schemas, untrusted manifest digests, and unexpected CLI options. It returns nonzero on failure before any downstream install action.

## Trust and scope limits

- This is **content integrity**, not a publisher signature, certificate chain, code signing, trusted release identity or root of trust by itself.
- A trusted manifest digest must be authenticated independently; a production installer requires a signed, expiring release manifest with public-key rotation/revocation and verified binary provenance.
- The script runs with an available Node.js runtime: a clean Windows Server/Linux host may **not** have Node installed. A future signed installer must bundle or supply its own trusted verified verifier/runtime and fail closed on unsupported hosts.
- File verification is read-only. Do not mount attacker-writable payloads concurrently with privileged installs; atomic unpack/verified-staging permissions and TOCTOU-resistant consumption remain required.
- This does not pin Docker OCI image digests, perform offline `docker load`, create a CA, start a server, configure firewall, migrate DB, register an installation ID, enroll agents or test WAN disconnection. All remain under [#80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80) after authorized stack decision [#79](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79).

See `tests/unit/lan-bundle-integrity.test.js` for tamper/negative/CLI tests.
