# Phase I — Windows Agent Installer and Command Trust

**Status: Development candidate only. Do not deploy to production endpoints.**

Phase I is a stacked change set on [Phase H PR #1](https://github.com/rehman2671/Aaditech-toolkit-new/pull/1), tracked by [Phase I PR #2](https://github.com/rehman2671/Aaditech-toolkit-new/pull/2).

## Windows build

The [Windows runner workflow](../../.github/workflows/phase-i-windows-msi.yml) uses Windows PowerShell 5.1 and pinned PS2EXE 1.0.18 to compile the real agent EXE, followed by WiX 5 `-arch x64` MSI compilation. It creates a **credential-free, UNENROLLED** test configuration, validates its HTTPS-only endpoint, verifies Windows Installer database metadata and OLE magic, runs a silent install, checks installed executable and scheduled task, then uninstalls and confirms cleanup.

The workflow deliberately does **not** publish or distribute unsigned test binaries. Genuine format/build is not equivalent to a trusted publisher signature.

### CI evidence (test-only)

Windows runner [run 42907807995](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/42907807995) compiled a 67,584-byte genuine ps2exe EXE and a 1,478,656-byte MSI (not the 1,536-byte fixtures) and logged successful install/uninstall and scheduled-task cleanup. The initial job logged a passing install/uninstall but reported a failed process status because the expected native `schtasks /Query` result after uninstall was nonzero. A later Windows run **[42908567117](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/42908567117) completed SUCCESSFULLY** after resetting the expected native exit code. This verifies a genuine 64-bit Windows runner EXE/MSI build, silent install, scheduled task creation, uninstall and task cleanup. **The installer remains unsigned and test-only.**

Current installer evidence is from a GitHub Windows runner and must be repeated on disposable Windows 10/11 VMs with snapshots before release.

## Safe installation and enrollment design

1. Build and **trusted-code-sign** the agent EXE and MSI with approved signing credentials outside the repository.
2. Review the signing certificate chain and SHA-256 hashes. Install the MSI on an authorized, disposable Windows test VM (not a personal or production PC).
3. The installed agent starts `UNENROLLED`: it has **no fleet API token, bootstrap token, device token, or signing key**. It must remain inert until provisioning. The MSI includes `Scripts/Provision-Device.ps1` for an elevated administrator to use.
4. Provision an HTTPS endpoint with a **valid, independently trusted server certificate**. Do not auto-install any root CA delivered by a remote enrollment server.
5. From an elevated PowerShell console, run the installed `Provision-Device.ps1`, supplying the HTTPS server URL with `-ServerUrl`. The tool prompts privately for the one-time bootstrap token. For example:
   ```powershell
   & "$env:ProgramFiles\IT-Toolkit\Scripts\Provision-Device.ps1" -ServerUrl 'https://rmm.example.com' -StartNow
   ```
6. Agent enrollment uses HTTPS POST only. The server must return a unique per-device token, unique device ID, and per-device command verification key. These are retained in locked-down ProgramData; the one-time bootstrap token is cleared from runtime config.
7. Agents must reject unsigned, mutated, expired, future-dated or cross-device commands. `AgentCommandTrust.psm1` verifies HMAC over a JSON envelope binding ID, device ID, hostname, kind, payload and validity window. Executable kinds are strictly allowlisted and `run-script` additionally requires a script allowlist.
8. The Windows MSI uninstall should remove the registered scheduled task and installed binary. Validate configuration and logs are not leaking secrets.

**Upgrade warning:** Previously installed agents with shared-fleet tokens/global HMAC-only credentials are NOT compatible with this strict production security model until securely re-enrolled. Plan migration, device inventory, operator approvals and rollback before attempting a fleet-wide upgrade.

## Remaining release gates

- Approved Authenticode signature and timestamp verification on EXE and MSI, on **clean Windows client VMs**.
- Complete Windows 10/11 install, repair, major upgrade, uninstall and rollback testing across least-privilege users; unsigned CI testing is insufficient.
- Real end-to-end TLS + enrollment against the actual management server, including certificate rotation/revocation and offline recovery.
- Durable, tenant-bound identity and command authorization; network isolation and mTLS trust-chain review.
- ProgramData ACLs and elevated scheduled task helper review. A low-privilege process must not influence privileged elevated job files.
- Verified Windows agent telemetry/heartbeat and signed remote-command execution against real Windows endpoints.
- Signed installer distribution and per-tenant bootstrap enrollment workflow (no embedded permanent credentials).
- Final green CI on the exact PR head and independent security review.

**Never** use `Enterprise/deploy/deploy.ps1` or `deploy.sh` for a production installer release without reviewing their legacy credential/endpoint generation; the new MSI builder intentionally refuses non-`UNENROLLED` configurations. The safe server bootstrap workflow remains `Enterprise/deploy/first-run.ps1` or `first-run.sh`.

## Relevant source

- `agent-command-security.js`: server signing and device-key derivation.
- `Scripts/Modules/AgentCommandTrust.psm1`: endpoint verification logic.
- `Enterprise/agent/Agent-Collect.ps1`: enrollment, token persistence, signed-command execution gate.
- `Enterprise/agent/wix/Assert-PackagingConfig.ps1`: packaging security checks.
- `Enterprise/agent/wix/build-msi.ps1`: WiX v5 x64 installer build.
- `Enterprise/agent/wix/verify-msi-lifecycle.ps1`: Windows actual MSI installation test.
- `Enterprise/agent/Provision-Device.ps1`: interactive, post-install device enrollment.
