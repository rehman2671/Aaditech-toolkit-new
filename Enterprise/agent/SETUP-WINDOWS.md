# Windows generic agent MSI — first-run and reconfiguration

## What changed

The Windows agent MSI is now intentionally **server-independent**. CI no
longer embeds `API_TOKEN`, a private LAN IP, or any final server endpoint.
It installs the agent binary, an unconfigured `agent.json`, and
`Configure-Agent.ps1`. The scheduled agent cannot send telemetry until
configuration is completed by an administrator.

The first-run setup is currently a **PowerShell interactive wizard**, not a
graphical MSI dialog or browser page. A full native Windows GUI is still a
separate planned enhancement.

## First installation on any supported Windows machine

1. Install a properly signed MSI using an elevated installer.
2. Deploy the actual production **HTTPS** server (DNS hostname and trusted
   certificate) using the Node/MySQL deployment path documented in
   `Enterprise/deploy/MYSQL-RECOVERY-AND-DEPLOYMENT.md`.
3. From the authenticated administrator portal, issue a **single-use device
   enrollment bootstrap token** for the correct tenant/workspace. Do not
   use JWT_SECRET, API_TOKEN or other server-wide secrets for this step.
4. Open Windows PowerShell **as Administrator** and run:

```powershell
& "C:\Program Files\IT-Toolkit\Configure-Agent.ps1" -TestConnection
```

The wizard asks for the server base URL (for example,
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

## Editing server details later (no MSI reinstall)

Re-run the same wizard with the new HTTPS hostname and a fresh single-use
tenant enrollment token. It retains the feature manifest and interval
settings, but clears the old `agent.token` and `client.pfx` when the
server or bootstrap credentials change. This prevents silently sending
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
  obtains an individual device token and uploads telemetry.
- Verify upgrade/reinstall retains required configuration, Windows ACLs,
  scheduled task permissions and endpoint edits.
- Rehearse server migration with a fresh token; confirm the old device
  token is no longer used after switching servers.

**Not yet verified:** Complete mTLS client certificate issuance (the
current production Node API uses HTTPS + per-device tokens instead), native
GUI first-run wizard, a physical Windows MSI installation, and live Hostinger
acceptance. Automated Windows regression checks verify the script contract
and configuration lifecycle but are not substitutes for those tests.
