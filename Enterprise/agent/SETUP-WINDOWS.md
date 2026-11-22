# Windows generic agent MSI — first-run and reconfiguration

## What changed

The Windows agent MSI is now intentionally **server-independent**. CI no
longer embeds `API_TOKEN`, a private LAN IP, or any final server endpoint.
It installs the agent binary, an unconfigured `agent.json`, both
`Configure-Agent.ps1` and `Configure-Agent-GUI.ps1`, and an all-users
Start Menu shortcut named **IT-Toolkit → Configure Agent Server**. The
scheduled agent cannot send telemetry until configuration is completed.

The Windows graphical wizard prompts for an HTTPS server hostname and a
hidden tenant-scoped enrollment token after the server is deployed. It
prompts for administrator approval via UAC and supports later reconfiguration.
When the GUI requests UAC elevation it now forwards an explicitly selected
config file path and rejects ambiguous quoted/newline paths, rather than
silently editing the default machine configuration on relaunch.

The installer does **not** yet open a native graphical dialog as part of
`msiexec` itself; setup is launched from the Start Menu after installation.

### N74 — private configuration before first credential write

The administrator setup wizard now restricts the ProgramData agent directory,
any existing runtime configuration, and an **empty** same-directory temporary
file to explicit SYSTEM/Administrators/NETWORK SERVICE permissions before a
single-use enrollment token is saved. The setter purges old explicit Everyone
or Users grants (not only inherited grants), verifies the actual ACL, and
aborts if Windows cannot prove the secret file is private. Both the old file
and replacement are protected before `File.Replace`; the final file is
verified again before completion. Windows CI regression simulates explicit
world-readable legacy directory/file ACLs and tests fresh installation.

This code safeguard cannot remediate secrets previously copied elsewhere or
replace managed-device Windows acceptance and independent security review.

### MSI upgrade version and release revision

Windows Installer compares only the first **three** product version fields.
The release pipeline now derives MSI `ProductVersion` as
`major.minor.(patch × 1000 + msi_revision)` from
`Enterprise/agent/agent-version.json`. For agent `1.1.2` with
`msi_revision: 1`, the actual MSI version is `1.1.2001`, which can
upgrade the older `1.1.2.x` packages whose fourth version field Windows
ignored. For each new release without a semver patch bump, increase the
`msi_revision` explicitly; do **not** rely on the build date. Keep the
stable WiX `UpgradeCode` unchanged.

### Runtime configuration lifecycle during MSI upgrades

The unprovisioned template in Program Files may be replaced on upgrade,
but the mutable `C:\ProgramData\ITToolkit-Agent\agent.json` must not be.
The WiX `AgentConfig` component now uses `NeverOverwrite=yes` and
`Permanent=yes` so a major upgrade cannot reset the configured HTTPS
origin, tenant bootstrap settings, enrolled device credential files or
runtime data when the older product is removed. **Important:** `Permanent`
also means the protected ProgramData config is deliberately retained
after a normal uninstall, allowing authorized reinstalls to recover their
settings. Operators decommissioning a device must deliberately revoke its
server-side device token and securely remove the local runtime data using
their approved device-decommissioning procedure. Never assume an MSI
uninstall automatically erases secrets.

A separate disposable Windows CI major-upgrade rehearsal
[passed in full CI run #43740938121](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43740938121).
It installed the base `1.1.2001` MSI, configured a synthetic HTTPS origin
and per-device identity, upgraded to `1.1.2002` and confirmed that the
endpoint, enrolled token and tenant identity remained intact. The scheduled
task and upgraded-product uninstall/cleanup also passed. This is a verified
Windows-runner upgrade, **not** signed release approval or proof of success
on managed production endpoints.

On a disposable GitHub-hosted Windows runner, full CI run
[43739352090](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43739352090)
**passed** actual silent installation of the x64 `1.1.2001` diagnostic
MSI, verified Program Files payload, restricted ProgramData agent.json ACL,
NETWORK SERVICE scheduled task, Start Menu link and the **installed** CLI
setup wizard, then successfully uninstalled and verified scheduled-task
and shortcut removal. This proves real Windows Installer execution on a
GitHub-hosted test runner, not signed-artifact trust, GUI/UAC interaction,
acceptance on your organization's managed endpoints.
Without `CODESIGN_PFX_B64`, CI correctly skips publication of the unsigned
diagnostic installer.

## First installation on any supported Windows machine

1. Install a properly signed MSI using an elevated installer.
2. Deploy the actual production **HTTPS** server (DNS hostname and trusted
   certificate) using the Node/MySQL deployment path documented in
   `Enterprise/deploy/MYSQL-RECOVERY-AND-DEPLOYMENT.md`.
3. From the authenticated administrator portal, issue a **single-use device
   enrollment bootstrap token** for the correct tenant/workspace. Do not
   use JWT_SECRET, API_TOKEN or other server-wide secrets for this step.
4. Launch **Start Menu → IT-Toolkit → Configure Agent Server**.
   Accept the Windows UAC prompt and enter the HTTPS server hostname and
   single-use token. Leave connection verification enabled.
   Alternatively, run the CLI setup as Administrator:

```powershell
& "C:\Program Files\IT-Toolkit\Configure-Agent.ps1" -TestConnection
```

The GUI/CLI asks for the server base URL (for example,
`https://toolkit.example.com`) and an enrollment token using hidden
input. It validates the URL, tests genuine TLS trust (if `-TestConnection`
is selected), and stores credentials under
`C:\ProgramData\ITToolkit-Agent\agent.json` with restricted ACLs.
No self-signed certificate is blindly trusted.

For fleet deployment when a secured temporary enrollment token file is
available:

```powershell
& "C:\Program Files\IT-Toolkit\Configure-Agent.ps1" `
    -ServerUrl "https://toolkit.example.com" `
    -TokenFile "C:\Secure\enrollment-token.txt" `
    -NonInteractive -TestConnection
```

The token is not accepted directly as a command-line argument, which
reduces exposure in process listings. Protect and delete the temporary
token file after configuration. Avoid putting long-lived shared credentials
in installer artifacts, images, or repository secrets.

After successful device enrollment, the worker stores its individual credential
in `agent.token` and its bound workspace/device identity in
`agent.identity.json`. It then **atomically clears the bootstrap token
from `agent.json`**; this protects reusable workspace enrollment tokens
from being retained on provisioned endpoints. If cleanup fails, the newly
issued local device credential is discarded rather than accepting an
insecurely provisioned state. Re-enrollment requires an administrator to
supply a new bootstrap credential.

## Editing server details later (no MSI reinstall)

Re-run the same wizard with the new HTTPS hostname and a fresh single-use
tenant enrollment token. It retains the feature manifest and interval
settings, but clears the old `agent.token`, `agent.identity.json`,
`client.pfx` and `ca.crt` when the server or bootstrap credentials change. This prevents silently sending
device credentials from one server/workspace to another. If the server and
bootstrap token are unchanged, the existing device identity is preserved.

The agent also honors the legacy machine policy overrides
`HKLM\SOFTWARE\ITToolkit\Agent\EndpointUrl` and `ApiToken`.
These take precedence over `agent.json`; the wizard refuses to make a
masked change unless the administrator explicitly passes
`-ClearRegistryOverride`. A centrally managed GPO may later reapply
those values.

## Operational acceptance checks

- Validate `https://<server>/healthz` returns a 200 response and the
  `components.database` value is `HEALTHY`.
- Run `Configure-Agent.ps1 -TestConnection` and confirm the user is prompted
  for setup values without printing the bootstrap token.
- Confirm the agent successfully enrolls only to its intended workspace,
  obtains an individual device token, clears the original bootstrap token
  from `agent.json` and uploads telemetry. Check file permissions on both
  `agent.token` and `agent.identity.json`.
- Verify upgrade/reinstall retains required configuration, Windows ACLs,
  scheduled task permissions and endpoint edits.
- Rehearse server migration with a fresh token; confirm the old device
  token is no longer used after switching servers.

**Not yet verified:** Complete mTLS client-certificate issuance
(the production Node API uses HTTPS + per-device tokens), a physical
MSI installation on the customer's own Windows machine with real
administrator/UAC interaction, a verified signed release, and live Hostinger
deployment acceptance. CI now checks the WinForms script
syntax, WiX components/shortcut, SecureString configuration lifecycle,
and extracts the MSI payload to verify the GUI and blank credentials.
These scripted checks are not substitutes for testing on a real Windows
machine. The existing device storage uses global hostname lookups; enrollment
now rejects ambiguous cross-tenant hostname/UID conflicts instead of
updating another tenant, but concurrent enrollment and full tenant-scoped
storage migrations remain separate production hardening work.
