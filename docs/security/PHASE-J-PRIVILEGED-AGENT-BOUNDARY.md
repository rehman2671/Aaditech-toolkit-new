# Phase J — Block untrusted SYSTEM escalation in Aaditech Windows agents

**Status: development-only, draft PR. Do not deploy this branch to production endpoints.**

## Threat model and decision

Aaditech's routine `ITToolkitAgent` scheduled task runs as `NETWORK SERVICE` with Modify access to `C:\ProgramData\ITToolkit-Agent\` for telemetry outbox, token files and logs. The old companion `ITToolkitAgentElevated` task ran as **SYSTEM/Highest**, was triggerable by NETWORK SERVICE and consumed a request at `elevated-job.json`. A compromised process sharing the routine task identity could modify that job and influence privileged behavior. A signed command received from the server is **not** sufficient to authorize a local Windows privilege escalation.

Phase J chooses **deny by default**, rather than relying on writable JSON, ACLs that grant the requesting identity Modify, or a new secret stored beside the same request.

## Implemented controls

- The MSI **never registers** the elevated SYSTEM task or ships its registration helper.
- On installation/repair/upgrade, the MSI invokes `Remove-LegacyElevatedTask.ps1`, which checks the legacy `ITToolkitAgentElevated` task and **fails the MSI installation if deletion or verification fails**. On uninstall it still removes both task registrations. Windows CI independently checks that the SYSTEM task is absent after installation and uninstall.
- The agent's `-ElevatedOnce` entrypoint exits with code **77** before reading config or touching runtime files. CI exercises the compiled EXE to prove this.
- Remote reboot returns a failed result with an explicit administrative approval message, even when the command HMAC is valid.
- Agent MSI auto-update is **disabled**. Windows upgrades require independently authenticated, administrator-approved tools such as Intune or an approved software deployment process. Do not download and execute an MSI on behalf of NETWORK SERVICE.
- The unused helper `Create-ElevatedTask.ps1` has been converted into a throwing compatibility stub.
- MSI installation runs ProgramData and Program Files configuration ACL hardening with `Return="check"` **before** creating the least-privileged routine scheduled task. Invalid or unprotected runtime credentials must not be ignored.
- The authoritative agent version is bumped to **1.1.3** to distinguish this security change from version 1.1.2.
- Six Pester regression tests inspect the trust boundary. The real Windows test workflow checks the absence of the elevated task, compiled `-ElevatedOnce` denial, runtime ACLs and cleanup.

## Operational implications

**No automatic reboot, privileged collectors or agent self-update are currently supported** by the endpoint. Telemetry, heartbeat, signed remote read-only commands and permitted unprivileged collectors are unaffected in intended design, subject to end-to-end testing.

Before installing an approved release on any managed Windows endpoint, an authorized administrator should identify/remove any existing legacy task:

```powershell
schtasks.exe /Query /TN ITToolkitAgentElevated
# If present and after following change-control approval:
schtasks.exe /Delete /TN ITToolkitAgentElevated /F
```

On a disposable VM, the signed 1.1.3 installer should remove it automatically, but that is **not** a substitute for migration checks on real managed machines. Verify `ITToolkitAgent` still runs as NETWORK SERVICE and has only expected rights. Never use this command blindly on non-Aaditech tasks.

## Required design before re-enabling privileged operations

A future broker requires a Windows service with an administrator-controlled identity and secure IPC boundary: a separate authenticated caller (not a token stored in the agent's writable folder), clear per-action authorization, operator approval, action-specific allowlisting, replay protection, signed and timestamped MSI validation, restricted file/registry ACLs, audit logs and tests against arbitrary NETWORK SERVICE processes. An agent-accessible `SYSTEM` task and JSON request file alone **must not** be reintroduced.

## Verification and remaining gates

The baseline Phase I commit `b0df095` passed CI, Docker/MySQL and genuine Windows MSI install/uninstall, but **that does not validate the Phase J changes**. Check the exact head of Phase J PR #3 in Windows CI, then test upgrade from the previous MSI in disposable Windows 10/11 VMs. Full Authenticode/revocation verification, privileged installer rollback and tenant security reviews remain open. Keep this PR draft and production release blocked.
