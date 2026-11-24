# Agent-Collect.ps1 - IT-Toolkit Enterprise agent worker
# Part of IT-Toolkit Enterprise (Phase 3). Wraps EXISTING toolkit scripts
# WITHOUT modifying them: runs them, sanitizes output, queues locally, and
# ships to the enterprise server. This is the file packaged as
# IT-Toolkit-Agent.exe by ps2exe and installed by the MSI.

[CmdletBinding()]
param(
    [string]$ConfigPath = "$env:ProgramData\ITToolkit-Agent\agent.json",
    [string]$QueueDb = "$env:ProgramData\ITToolkit-Agent\queue.sqlite3",
    [int]$LoopMinutes = 0,
    [switch]$CollectOnly,
    [switch]$FlushOnly,
    [switch]$ElevatedOnce
)

$ErrorActionPreference = 'Stop'

# Legacy MSI could launch this worker as SYSTEM from a lower-privilege
# request. Reject that entry point before config, modules, queue or network.
if ($ElevatedOnce) {
    Write-Output 'LEGACY_ELEVATED_WORKER_DISABLED'
    exit 3
}

function Resolve-ToolkitRoot {
    # Installed layout:  <InstallRoot>\Scripts\Modules, <InstallRoot>\Config
    # Repo layout:       <repo>\Scripts\Modules,       <repo>\Config
    $candidates = @(
        (Join-Path $PSScriptRoot 'Scripts\Modules'),
        (Join-Path $PSScriptRoot '..\..\Scripts\Modules')
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c 'SanitizeEngine.psm1')) {
            return Split-Path (Split-Path $c -Parent) -Parent   # <root>\Scripts\Modules -> <root>
        }
    }
    return $PSScriptRoot
}
$script:RepoRoot    = Resolve-ToolkitRoot
$script:ModulesPath = Join-Path $script:RepoRoot 'Scripts\Modules'

function Write-AgentLog {
    param([string]$Message)
    $dir = Split-Path $ConfigPath -Parent
    $logDir = Join-Path $dir 'logs'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path (Join-Path $logDir 'agent.log') -Value $line -ErrorAction SilentlyContinue
    Write-Verbose $line
}

# E4: whether THIS process is running with an elevated (admin) token. The
# routine scheduled task runs as NETWORK SERVICE (least privilege), so elevated
# collectors (bitlocker, licenses, printer-fix, user inventory…) only run under
# the on-demand elevated task; they are opt-in here and skipped otherwise.
function Test-IsElevated {
    try {
        $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    catch { return $false }
}

# Compatibility function: never stage or delegate any privileged work.
function Request-ElevatedJob {
    param([string]$Action,[hashtable]$Payload = @{})
    return $false
}

function Read-AgentConfig {
    if (-not (Test-Path $ConfigPath)) {
        throw "Agent config not found at $ConfigPath. Reinstall the MSI or run build-agent.ps1."
    }
    try { $cfg = (Get-Content $ConfigPath -Raw | ConvertFrom-Json) }
    catch { throw "Invalid agent.json: $($_.Exception.Message)" }

    # Registry override knob (A4): HKLM\SOFTWARE\ITToolkit\Agent\EndpointUrl
    # and/or ApiToken override agent.json at startup. This is what makes the
    # GPO/manual redirect real without a reinstall. Empty/missing values fall
    # back to the file.
    $regKey = 'HKLM:\SOFTWARE\ITToolkit\Agent'
    if (Test-Path $regKey) {
        $policy = Get-ItemProperty -Path $regKey -ErrorAction SilentlyContinue
        if ($policy) {
            $endpoint = $policy.PSObject.Properties['EndpointUrl']
            $token = $policy.PSObject.Properties['ApiToken']
            if ($endpoint -and $endpoint.Value) {
                $cfg.endpoint = [string]$endpoint.Value
                Write-AgentLog "Registry override: endpoint -> $($endpoint.Value)"
            }
            if ($token -and $token.Value) {
                $cfg.token = [string]$token.Value
                Write-AgentLog 'Registry override: token applied'
            }
        }
    }
    # Validate AFTER GPO/registry overrides. On first run the bootstrap
    # token authorizes enrollment; afterwards that secret is removed and the
    # paired enrolled device token + tenant identity authorize the agent.
    $configDir = Split-Path $ConfigPath -Parent
    $tokenPath = Join-Path $configDir 'agent.token'
    $identityPath = Join-Path $configDir 'agent.identity.json'
    $hasToken = Test-Path -LiteralPath $tokenPath -PathType Leaf
    $hasIdentity = Test-Path -LiteralPath $identityPath -PathType Leaf
    if ($hasToken -ne $hasIdentity) {
        throw 'Incomplete enrolled device identity. Re-run setup with a new tenant enrollment token.'
    }
    $enrolled = $false
    if ($hasToken) {
        try {
            $deviceToken = (Get-Content -LiteralPath $tokenPath -Raw -ErrorAction Stop).Trim()
            $identity = Get-Content -LiteralPath $identityPath -Raw -ErrorAction Stop | ConvertFrom-Json
            $enrolled = $deviceToken.StartsWith('itk_dev_') -and
                -not [string]::IsNullOrWhiteSpace([string]$identity.device_id) -and
                -not [string]::IsNullOrWhiteSpace([string]$identity.tenant_id) -and
                -not [string]::IsNullOrWhiteSpace([string]$identity.device_uid)
        } catch {
            $enrolled = $false
        }
        if (-not $enrolled) { throw 'Invalid enrolled device credential or tenant identity. Re-run setup.' }
    }
    if ([string]::IsNullOrWhiteSpace([string]$cfg.endpoint) -or
        (([string]::IsNullOrWhiteSpace([string]$cfg.token)) -and -not $enrolled)) {
        throw 'Agent is not provisioned. Configure the HTTPS server and a tenant enrollment token.'
    }
    return $cfg
}

# ---------------------------------------------------------------- mTLS client cert (hardening)
# When the config carries an enroll_url, the agent fetches a client-auth cert
# signed by the server's local CA once (bearer token auth) and then presents it
# to the agent mTLS endpoint (port 9443). Without enroll_url the agent keeps
# using plain bearer-token auth, so this is fully backward compatible.

function Get-ClientCertPath {
    param($Config)
    if (-not $Config.enroll_url) { return $null }
    $dir = Split-Path $ConfigPath -Parent
    return Join-Path $dir 'client.pfx'
}

function Get-AgentTokenPath {
    # B6: after enrolling, the agent stores its OWN per-agent token beside the
    # cert. That token replaces the shared fleet token for ingest/commands, so a
    # leaked fleet token can't impersonate every box.
    $dir = Split-Path $ConfigPath -Parent
    return Join-Path $dir 'agent.token'
}

function Get-AgentToken {
    # Prefer the per-agent token from enroll (B6); fall back to the shared
    # config token (bootstrap / pre-B6 agents).
    param($Config)
    $path = Get-AgentTokenPath
    if (Test-Path $path) {
        $tok = (Get-Content $path -Raw -ErrorAction SilentlyContinue).Trim()
        if ($tok) { return $tok }
    }
    return $Config.token
}

function Install-ServerCa {
    # The agent talks to the mTLS endpoint (https://<host>:9443) whose server
    # cert is signed by the server's INTERNAL CA. For Invoke-RestMethod to
    # accept that cert, the CA must be trusted on this machine. We install it
    # into the LocalMachine Root store (agent runs as SYSTEM) once. certutil
    # exits non-zero if the cert is already present, which is fine.
    param([string]$CaPem)
    if ([string]::IsNullOrWhiteSpace($CaPem)) { return }
    $dir = Split-Path $ConfigPath -Parent
    $caPath = Join-Path $dir 'ca.crt'
    try {
        [IO.File]::WriteAllText($caPath, $CaPem)
        & certutil.exe -addstore Root $caPath 2>&1 | Out-Null
        Write-AgentLog "Installed IT-Toolkit CA into LocalMachine\Root (server trust)"
    }
    catch {
        Write-AgentLog "CA trust install failed: $($_.Exception.Message)"
    }
}

# Once an individual device credential has been persisted, remove the
# bootstrap credential from persistent agent.json. Bootstrap tokens may be
# reusable across a workspace and are not runtime authentication tokens.
# Atomic replacement preserves the current config on interruption.
function Clear-EnrollmentBootstrapToken {
    param($Config)
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        throw 'Cannot clear enrollment token: agent config is missing'
    }
    $onDisk = Get-Content -LiteralPath $ConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json
    if ($onDisk.PSObject.Properties.Name -notcontains 'token') { return }
    $hasSecondaryBootstrap = $onDisk.PSObject.Properties.Name -contains 'bootstrap_token'
    if (-not $onDisk.token -and
        (-not $hasSecondaryBootstrap -or -not $onDisk.bootstrap_token)) {
        $Config.token = ''
        if ($Config.PSObject.Properties.Name -contains 'bootstrap_token') {
            $Config.bootstrap_token = ''
        }
        return
    }
    $configDir = Split-Path $ConfigPath -Parent
    $tempPath = Join-Path $configDir ("agent.json.tmp." + [guid]::NewGuid().ToString('N'))
    $backupPath = Join-Path $configDir ("agent.json.backup." + [guid]::NewGuid().ToString('N'))
    $replaced = $false
    try {
        $onDisk.token = ''
        if ($hasSecondaryBootstrap) { $onDisk.bootstrap_token = '' }
        $cleanConfig = $onDisk | ConvertTo-Json -Depth 12
        [IO.File]::WriteAllText($tempPath, $cleanConfig, ([Text.UTF8Encoding]::new($false)))
        [IO.File]::Replace($tempPath, $ConfigPath, $backupPath)
        $replaced = $true
        $Config.token = ''
        if ($Config.PSObject.Properties.Name -contains 'bootstrap_token') {
            $Config.bootstrap_token = ''
        }
    }
    finally {
        if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
        if ($replaced -and (Test-Path -LiteralPath $backupPath)) {
            Remove-Item -LiteralPath $backupPath -Force
        }
    }
}

function Ensure-ClientCert {
    param($Config)
    $pfx = Get-ClientCertPath -Config $Config
    if (-not $pfx) { return $null }
    $dir = Split-Path $ConfigPath -Parent
    $caPath = Join-Path $dir 'ca.crt'
    $tokenPath = Get-AgentTokenPath

    # Node/MySQL enrollment issues a per-device token, not a client PFX.
    # Once that token has been saved, do not consume the single-use bootstrap
    # token again on every cycle. HTTPS + device token remain in effect.
    if ((Test-Path $tokenPath) -and (-not (Test-Path $pfx))) {
        return $null
    }

    # If a CA was already bundled (e.g. copied by install.cmd) or previously
    # enrolled, make sure it is trusted before the first mTLS call. Pre-B6
    # agents have a cert but no per-agent token: re-enroll once (idempotent,
    # server keeps the same cert+token) so they get their own token too.
    if (Test-Path $pfx) {
        # C6: cert exists but is near expiry / missing token -> renew. The server
        # re-issues a fresh cert (issue_client_cert renews expiring ones), so we
        # drop the old cert and re-enroll below.
        if ((Test-ClientCertExpiry -PfXPath $pfx) -or (-not (Test-Path $tokenPath))) {
            Write-AgentLog "Client cert expired/near-expiry or token missing — renewing cert (C6)"
            Remove-Item $pfx -Force -ErrorAction SilentlyContinue
            Remove-Item $tokenPath -Force -ErrorAction SilentlyContinue
        }
        else {
            if (-not (Test-Path $caPath)) {
                $dir2 = Split-Path $pfx -Parent
                $cand = Join-Path $dir2 'ca.crt'
                if (Test-Path $cand) { Copy-Item $cand $caPath -Force }
            }
            if (Test-Path $caPath) { Install-ServerCa (Get-Content $caPath -Raw) }
            return $pfx
        }
    }

    Write-AgentLog "Enrolling for device credentials from $($Config.enroll_url)"
    try {
        $hn = (Get-AgentHostname)
        $enrollBody = @{
            bootstrap_token = $Config.token
            hostname        = $hn
            device_uid      = "dev-uid-$($hn.ToLower())"
            os_version      = [System.Environment]::OSVersion.VersionString
            agent_version   = (Get-InstalledAgentVersion)
        } | ConvertTo-Json -Compress

        # Enroll via POST only. GET/query-token fallbacks risk credential
        # exposure in access logs, browser history and intermediary caches.
        $resp = Invoke-RestMethod -Uri $Config.enroll_url -Method Post `
            -Headers @{
                Authorization       = "Bearer $($Config.token)"
                "X-Bootstrap-Token" = $Config.token
            } -ContentType 'application/json' -Body $enrollBody

        $issuedToken = if ($resp.device_token) { $resp.device_token } elseif ($resp.agent_token) { $resp.agent_token } else { $null }
        if ($issuedToken) {
            if (-not $resp.device_id -or -not $resp.tenant_id -or -not $resp.device_uid) {
                throw 'Enrollment response did not bind device and tenant identity'
            }
            $identity = @{ device_id = [string]$resp.device_id; tenant_id = [string]$resp.tenant_id; device_uid = [string]$resp.device_uid } | ConvertTo-Json -Compress
            [IO.File]::WriteAllText((Join-Path $dir 'agent.identity.json'), $identity)
            [IO.File]::WriteAllText($tokenPath, [string]$issuedToken)
            try {
                Clear-EnrollmentBootstrapToken -Config $Config
            } catch {
                # Never leave a usable device token beside an uncleared,
                # potentially reusable workspace enrollment secret.
                Remove-Item -LiteralPath $tokenPath -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath (Join-Path $dir 'agent.identity.json') -Force -ErrorAction SilentlyContinue
                throw "Unable to clear bootstrap secret after enrollment: $($_.Exception.Message)"
            }
            Write-AgentLog 'Per-device token saved; reusable bootstrap token cleared from agent.json'
        }

        if ($resp.pfx) {
            [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($resp.pfx))
            Write-AgentLog "Client cert saved to $pfx"
        }
        if ($resp.ca) {
            [IO.File]::WriteAllText($caPath, $resp.ca)
            Install-ServerCa $resp.ca
        }
        return $pfx
    }
    catch {
        Write-AgentLog "Enrollment failed: $($_.Exception.Message) — falling back to configured token"
        return $null
    }
}

function Get-RestCertificate {
    param($Config)
    $pfx = Get-ClientCertPath -Config $Config
    if (-not $pfx -or -not (Test-Path $pfx)) { return $null }
    try { return New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($pfx) }
    catch { Write-AgentLog "Failed to load client cert: $($_.Exception.Message)"; return $null }
}

function Test-ClientCertExpiry {
    # C6: True when the persisted client cert is already expired or within the
    # renewal window (default 45 days). Near-expiry triggers a re-enroll so the
    # agent never gets stranded after mTLS cert expiry (Caddy needs client auth).
    param(
        [string]$PfXPath,
        [int]$RenewDays = 45
    )
    if (-not (Test-Path $PfXPath)) { return $true }  # missing -> (re)enroll
    try {
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($PfXPath)
        $daysLeft = ($cert.NotAfter - (Get-Date)).TotalDays
        Write-AgentLog ("Client cert " + $cert.NotAfter.ToString('yyyy-MM-dd') + " — " + [math]::Floor($daysLeft) + " days left")
        return ($daysLeft -le $RenewDays)
    }
    catch {
        # unreadable/corrupt -> treat as needing renewal
        Write-AgentLog "Client cert unreadable ($($_.Exception.Message)) — will re-enroll"
        return $true
    }
}

function Add-BundledSqliteToPath {
    # The MSI installs sqlite3.exe beside the agent exe so the queue works on
    # stock Windows (no system-wide SQLite needed). Prepend that directory to
    # PATH so the shared ToolkitData module's `sqlite3` lookup finds it.
    $candidates = @(
        $PSScriptRoot,
        (Join-Path $script:RepoRoot 'Scripts\Modules')
    ) | Select-Object -Unique
    foreach ($dir in $candidates) {
        $sqlite = Join-Path $dir 'sqlite3.exe'
        if (Test-Path $sqlite) {
            if ($env:PATH -split ';' -notcontains $dir) {
                $env:PATH = "$dir;$env:PATH"
            }
            return
        }
    }
    Write-AgentLog "sqlite3.exe not found beside the agent; relying on PATH"
}

function Import-ToolkitModules {
    # Reuse existing modules unchanged.
    Add-BundledSqliteToPath
    Import-Module (Join-Path $script:ModulesPath 'SanitizeEngine.psm1') -Force
    Import-Module (Join-Path $script:ModulesPath 'ToolkitData.psm1') -Force
}

function Initialize-Queue {
    if (-not (Test-Path (Split-Path $QueueDb -Parent))) {
        New-Item -ItemType Directory -Path (Split-Path $QueueDb -Parent) -Force | Out-Null
    }
    $schema = @"
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  sanitized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS queue_identity (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  instance_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telemetry_outbox (
  batch_id TEXT PRIMARY KEY,
  body_json TEXT NOT NULL,
  event_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_pending ON telemetry_outbox (status) WHERE status='pending';
CREATE TABLE IF NOT EXISTS executed_commands (
  command_id   INTEGER PRIMARY KEY,
  status       TEXT NOT NULL,
  output       TEXT NOT NULL DEFAULT '',
  exit_code    INTEGER NOT NULL DEFAULT 0,
  executed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS executed_commands_v2 (
  command_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','completed','failed')),
  output TEXT NOT NULL DEFAULT '',
  exit_code INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS command_results_v3 (
  command_id TEXT PRIMARY KEY NOT NULL,
  binding TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','completed','failed')),
  body TEXT NOT NULL DEFAULT '',
  delivery TEXT NOT NULL DEFAULT 'none' CHECK (delivery IN ('none','pending','acknowledged')),
  last_attempt TEXT NOT NULL DEFAULT '',
  CHECK ((status='claimed' AND delivery='none' AND body='') OR
         (status IN ('completed','failed') AND delivery IN ('pending','acknowledged') AND body<>''))
);
CREATE INDEX IF NOT EXISTS idx_command_results_v3_pending ON command_results_v3(binding,delivery,last_attempt,command_id);
"@
    Invoke-SQLite -Query $schema -DatabasePath $QueueDb | Out-Null
    # One random queue lifetime identifier; old queues preserve it on upgrade.
    # A clean SQLite DB after reinstall gets a new identity, not a reused ID.
    $freshId = [guid]::NewGuid().ToString('N')
    Invoke-SQLite -Query "INSERT OR IGNORE INTO queue_identity (singleton_id, instance_id) VALUES (1, '$freshId');" -DatabasePath $QueueDb | Out-Null
    # Prune old acknowledged requests but NEVER delete pending payloads.
    Invoke-SQLite -Query "DELETE FROM telemetry_outbox WHERE status='delivered' AND created_at < datetime('now','-7 days');" -DatabasePath $QueueDb | Out-Null
}

function Get-QueueInstanceId {
    if ($script:QueueInstanceId) { return $script:QueueInstanceId }
    $raw = Invoke-SQLite -Query "SELECT instance_id FROM queue_identity WHERE singleton_id = 1;" -DatabasePath $QueueDb -AsJson
    if ([string]::IsNullOrWhiteSpace($raw)) { throw 'Queue identity missing: refusing unstable event IDs' }
    $rows = @($raw | ConvertFrom-Json)
    if ($rows.Count -ne 1) { throw 'Queue identity invalid: expected exactly one row' }
    $id = [string]$rows[0].instance_id
    if ($id -notmatch '^[0-9a-fA-F]{32}$') { throw 'Invalid persistent queue identity' }
    $script:QueueInstanceId = $id.ToLowerInvariant()
    return $script:QueueInstanceId
}

# Preserve historical integer rows; server command IDs are canonical UUIDs.
function ConvertTo-CommandUuid {
    param([string]$CommandId)
    if ($CommandId -cnotmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        throw 'Invalid server command UUID'
    }
    return $CommandId.ToLowerInvariant()
}

# Bind results to the exact HTTPS origin, enrolled recipient and current
# credential. No raw token, endpoint, or tenant ID is persisted in the ledger.
function Get-CommandResultOrigin {
    param($Config)
    $root = [string]$Config.endpoint -replace '(/api/v1/ingest/telemetry|/api/ingest|/ingest)\s*$', ''
    $uri = $null
    if (-not [uri]::TryCreate($root, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -cne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        $uri.AbsolutePath -ne '/' -or -not $uri.Host) { throw 'Command result requires a configured HTTPS origin' }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function Get-CommandDeliveryContext {
    param($Config)
    $origin = Get-CommandResultOrigin $Config
    $fresh = Read-AgentConfig
    if ((Get-CommandResultOrigin $fresh) -cne $origin) { throw 'Command result origin changed; restart configured agent' }
    $token = (Get-Content -LiteralPath (Get-AgentTokenPath) -Raw -ErrorAction Stop).Trim()
    if ($token -cnotmatch '^itk_dev_[a-f0-9]{48}$') { throw 'Individual device credential required' }
    $identity = Get-Content -LiteralPath (Join-Path (Split-Path $ConfigPath -Parent) 'agent.identity.json') -Raw -ErrorAction Stop | ConvertFrom-Json
    foreach ($field in @('device_id','tenant_id','device_uid')) {
        if ($identity.$field -isnot [string] -or [string]::IsNullOrWhiteSpace($identity.$field)) { throw 'Enrolled identity required' }
    }
    $material = [ordered]@{ origin=$origin; device_id=$identity.device_id; tenant_id=$identity.tenant_id; device_uid=$identity.device_uid; hostname=(Get-AgentHostname).ToLowerInvariant() } | ConvertTo-Json -Compress
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    try {
        $hmac.Key = [Text.Encoding]::UTF8.GetBytes($token)
        $digest = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("aaditech:command-result-binding:v1" + [char]10 + $material))
        $binding = ([BitConverter]::ToString($digest)).Replace('-', '').ToLowerInvariant()
    } finally { $hmac.Dispose() }
    return [pscustomobject]@{ origin=$origin; token=$token; binding=$binding }
}

function Assert-CommandBinding {
    param([string]$Binding)
    if ($Binding -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid command delivery binding' }
}

function Try-ClaimVerifiedCommand {
    param([string]$CommandId, [string]$Binding)
    $id = ConvertTo-CommandUuid $CommandId
    Assert-CommandBinding $Binding
    # Old v2 rows lack recipient/origin provenance: retain and refuse to
    # re-execute them, never invent their binding or automatically resend.
    $changed = Invoke-SQLite -Query "INSERT OR IGNORE INTO command_results_v3 (command_id,binding,status) SELECT '$id','$Binding','claimed' WHERE NOT EXISTS (SELECT 1 FROM executed_commands_v2 WHERE command_id='$id'); SELECT changes();" -DatabasePath $QueueDb
    $count = ($changed -join '').Trim()
    if ($count -notin @('0','1')) { throw 'Uncertain local command claim; refusing execution' }
    return ($count -eq '1')
}

function ConvertTo-CommandResult {
    param($Result)
    $status = [string]$Result.status
    $exitCode = [int]$Result.exit_code
    if ($status -notin @('completed','failed')) { $status = 'failed'; $exitCode = 1 }
    if ($status -eq 'completed' -and $exitCode -ne 0) { $status = 'failed' }
    $output = [string]$Result.output
    if ($output) { $output = [string](ConvertTo-SanitizedText -Text $output) }
    if ($output.Length -gt 32768) { $output = $output.Substring(0,32768) }
    return @{ status = $status; output = $output; exit_code = $exitCode }
}

# Encode the bounded JSON body as SQLite hex, not interpolated output text.
# A single atomic UPDATE stores the outcome and pending-delivery marker.
function Record-ExecutedCommand {
    param([string]$CommandId, [string]$Binding, $Result)
    $id = ConvertTo-CommandUuid $CommandId
    Assert-CommandBinding $Binding
    $status = [string]$Result.status
    if ($status -cnotin @('completed','failed')) { throw 'Non-terminal command outcome' }
    # Bound the actual Windows sqlite3 command-line size, even for JSON escapes.
    # Never send a different representation from the stored result body.
    $output = [string]$Result.output
    if ($output.Length -gt 1024) { $output = $output.Substring(0, 1000) + ' [output truncated]' }
    $body = [ordered]@{ status=$status; output=$output; exit_code=[int]$Result.exit_code } | ConvertTo-Json -Compress
    $bodyHex = ([BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($body))).Replace('-', '').ToLowerInvariant()
    $changed = Invoke-SQLite -Query "UPDATE command_results_v3 SET status='$status',body=CAST(X'$bodyHex' AS TEXT),delivery='pending' WHERE command_id='$id' AND binding='$Binding' AND status='claimed' AND delivery='none'; SELECT changes();" -DatabasePath $QueueDb
    if (($changed -join '').Trim() -ne '1') { throw 'Command result was not durably recorded' }
}

function ConvertFrom-CollectorOutput {
    # Collectors (Enterprise/agent/collectors/*) emit one JSON object so the
    # server can build fleet panels. Anything that doesn't parse as JSON is
    # treated as plain text and wrapped in { text = ... } as before.
    param([string]$Raw)
    if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
    try { return ($Raw | ConvertFrom-Json) }
    catch { return $Raw }
}

function ConvertTo-JsonPayload {
    param([object]$Result)
    if ($null -eq $Result) { return (@{} | ConvertTo-Json -Compress) }
    if ($Result -is [string]) {
        $sanitized = ConvertTo-SanitizedText -Text $Result
        return (@{ text = $sanitized } | ConvertTo-Json -Compress)
    }
    $sanitized = $Result | Protect-SanitizedContent
    return ($sanitized | ConvertTo-Json -Compress -Depth 10)
}

function Invoke-AgentScript {
    param(
        [string]$ScriptPath,
        [int]$TimeoutSeconds = 300
    )
    # W7: feature scripts (QuickCheck, Network-Diagnostic, Export-EventLogs, ...)
    # contain interactive Read-Host prompts and some spawn GUI apps (notepad).
    # Under the Task Scheduler NETWORK SERVICE context there is no console, so a
    # Read-Host would block forever and stall the collection cycle. Run each
    # script in an isolated child PowerShell with stdin fed from NUL (EOF makes
    # any Read-Host return immediately) and a hard timeout, then return output.
    $psExe = if ($PSVersionTable.PSEdition -eq 'Core') {
        Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    } else {
        (Get-Process -Id $PID).Path
    }
    $childArgs = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command', "& `"$ScriptPath`" 2>&1 | Out-String")
    # Start-Process requires the redirected stdin file to already exist (EOF
    # means any Read-Host in the child returns immediately instead of hanging).
    $stdinFile = Join-Path $env:TEMP 'itk-agent-stdin.txt'
    $stdoutFile = Join-Path $env:TEMP 'itk-agent-stdout.txt'
    $stderrFile = Join-Path $env:TEMP 'itk-agent-stderr.txt'
    Set-Content -Path $stdinFile -Value '' -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $psExe -ArgumentList $childArgs -NoNewWindow `
        -RedirectStandardInput $stdinFile `
        -RedirectStandardOutput $stdoutFile `
        -RedirectStandardError $stderrFile -PassThru
    if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
        try { $p.Kill() } catch { }
        throw "Script timed out after ${TimeoutSeconds}s: $ScriptPath"
    }
    $out = ''
    if (Test-Path $stdoutFile) { $out = Get-Content $stdoutFile -Raw }
    $err = ''
    if (Test-Path $stderrFile) { $err = Get-Content $stderrFile -Raw }
    Remove-Item $stdinFile, $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) { throw "Script exited with code $($p.ExitCode): $ScriptPath $err" }
    return $out
}

function Invoke-AgentCollection {
    param($Config)
    $results = @()
    $endpoint = $Config.endpoint
    $token = $Config.token

    foreach ($feature in $Config.features) {
        if (-not $feature.enabled) { continue }
        # Elevated collectors require a separate reviewed local execution
        # boundary. Never run them through the automatic installed worker.
        if ([bool]$feature.requires_elevation) {
            Write-AgentLog "Skipping $($feature.name): separate administrator approval required"
            continue
        }
        $scriptPath = $feature.script
        if (-not [System.IO.Path]::IsPathRooted($scriptPath)) {
            $scriptPath = Join-Path $script:RepoRoot $feature.script
        }
        if (-not (Test-Path $scriptPath)) {
            Write-AgentLog "Skipping $($feature.name): script missing $scriptPath"
            continue
        }
        try {
            Write-AgentLog "Running $($feature.name) ($scriptPath)"
            $output = Invoke-AgentScript -ScriptPath $scriptPath
            $structured = ConvertFrom-CollectorOutput -Raw $output
            $payload = ConvertTo-JsonPayload -Result $structured
            Invoke-SQLite -Query "INSERT INTO outbox (kind, payload, sanitized) VALUES ('$($feature.name)', '$($payload.Replace("'","''"))', 1);" -DatabasePath $QueueDb | Out-Null
            $results += $feature.name
        }
        catch {
            Write-AgentLog "Collection failed for $($feature.name): $($_.Exception.Message)"
            # Still queue the error so the server sees agent health issues.
            $err = @{ feature = $feature.name; error = $_.Exception.Message } | ConvertTo-Json -Compress
            Invoke-SQLite -Query "INSERT INTO outbox (kind, payload, sanitized) VALUES ('agent-error', '$($err.Replace("'","''"))', 1);" -DatabasePath $QueueDb | Out-Null
        }
    }
    return $results
}

function Get-AgentHostname {
    foreach ($candidate in @($env:COMPUTERNAME, $env:HOSTNAME)) {
        if ($candidate) { return $candidate }
    }
    $hn = (& hostname 2>$null)
    if ($hn) { return $hn.Trim() }
    return 'unknown-host'
}

function Get-AgentIP {
    <#
    .SYNOPSIS
        Best-effort IPv4 address of this machine ('' on any failure so a flush
        can never be killed by IP discovery).
    #>
    try {
        if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
            $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
                Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } |
                Select-Object -First 1 -ExpandProperty IPAddress
            if ($ip) { return $ip }
        }
        # fallback: parse ifconfig/ipconfig output
        $raw = (& ifconfig 2>$null) -join "`n"
        if ($raw) {
            $m = [regex]::Match($raw, '(?m)inet (addr:)?(\d{1,3}(\.\d{1,3}){3})')
            if ($m.Success) {
                $cand = $m.Groups[2].Value
                if ($cand -notlike '127.*') { return $cand }
            }
        }
    } catch { }
    return ''
}

function Send-AgentHeartbeat {
    param($Config)
    # E1: lightweight liveness ping on the dedicated heartbeat route (same
    # mTLS origin as /ingest), so last_seen stays fresh even when the queue is
    # empty and there are no pending commands to poll.
    $body = @{
        hostname      = (Get-AgentHostname)
        os            = [System.Environment]::OSVersion.VersionString
        agent_version = (Get-InstalledAgentVersion)
        ip            = (Get-AgentIP)
    } | ConvertTo-Json -Compress
    $uri = "$(Get-CommandsApiRoot)/api/agent/heartbeat"
    $cert = Get-RestCertificate -Config $Config
    $agentTok = Get-AgentToken -Config $Config
    $headers = @{ 
        "Authorization"  = "Bearer $agentTok"
        "X-Device-Token" = $agentTok 
    }
    if ($cert) {
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType 'application/json' -Body $body -Certificate $cert
    }
    else {
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType 'application/json' -Body $body
    }
}


# N26: these host probes run at SEND time, not on stale queued event data.
# NETWORK SERVICE may lack permissions: unknown is NULL, never invented 0.
function Get-FreshAgentSnapshot {
    $metrics = @{
        cpu = @{ utilization_pct = $null }
        ram = @{ utilization_pct = $null }
        disk = @{ free_gb = $null; total_gb = $null }
    }
    try {
        $cpus = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
        $loads = @($cpus | ForEach-Object {
            if ($null -ne $_.LoadPercentage -and [double]$_.LoadPercentage -ge 0 -and [double]$_.LoadPercentage -le 100) {
                [double]$_.LoadPercentage
            }
        })
        if ($cpus.Count -gt 0 -and $cpus.Count -eq $loads.Count) {
            $metrics.cpu.utilization_pct = [math]::Round(($loads | Measure-Object -Average).Average, 1)
        }
    } catch { }
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        if ($null -ne $os.TotalVisibleMemorySize -and $null -ne $os.FreePhysicalMemory -and
            [double]$os.TotalVisibleMemorySize -gt 0 -and [double]$os.FreePhysicalMemory -ge 0 -and
            [double]$os.FreePhysicalMemory -le [double]$os.TotalVisibleMemorySize) {
            $metrics.ram.utilization_pct = [math]::Round(
                (1 - [double]$os.FreePhysicalMemory / [double]$os.TotalVisibleMemorySize) * 100, 1)
        }
    } catch { }
    try {
        $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType = 3" -ErrorAction Stop |
            Where-Object { $_.DeviceID -eq $env:SystemDrive } | Select-Object -First 1
        if ($disk -and $null -ne $disk.Size -and $null -ne $disk.FreeSpace -and
            [double]$disk.Size -gt 0 -and [double]$disk.FreeSpace -ge 0 -and
            [double]$disk.FreeSpace -le [double]$disk.Size) {
            $metrics.disk.total_gb = [math]::Round([double]$disk.Size / 1GB, 2)
            $metrics.disk.free_gb = [math]::Round([double]$disk.FreeSpace / 1GB, 2)
        }
    } catch { }

    $bitlocker = 'UNKNOWN'
    try {
        $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop
        if ($bl -and $null -ne $bl.ProtectionStatus) {
            if ([int]$bl.ProtectionStatus -eq 1) { $bitlocker = 'PROTECTED' }
            elseif ([int]$bl.ProtectionStatus -eq 0) { $bitlocker = 'UNPROTECTED' }
        }
    } catch { }
    $antivirus = 'UNKNOWN'
    $antivirusName = $null
    try {
        $mp = Get-MpComputerStatus -ErrorAction Stop
        if ($null -ne $mp.AntivirusEnabled -and $null -ne $mp.RealTimeProtectionEnabled) {
            $antivirus = if ($mp.AntivirusEnabled -and $mp.RealTimeProtectionEnabled) { 'ACTIVE' } else { 'INACTIVE' }
            $antivirusName = 'Microsoft Defender Antivirus'
        }
    } catch { }
    $firewall = 'UNKNOWN'
    try {
        $profiles = @(Get-NetFirewallProfile -ErrorAction Stop)
        if ($profiles.Count -gt 0) {
            if (@($profiles | Where-Object { $_.Enabled -eq $false }).Count -gt 0) {
                $firewall = 'DISABLED'
            } elseif (@($profiles | Where-Object { $_.Enabled -eq $true }).Count -eq $profiles.Count) {
                $firewall = 'ENABLED'
            }
        }
    } catch { }
    # Device-reported heuristic only: never an attested compliance verdict.
    $score = $null
    if ($bitlocker -ne 'UNKNOWN' -and $antivirus -ne 'UNKNOWN' -and $firewall -ne 'UNKNOWN') {
        $score = 100
        if ($bitlocker -ne 'PROTECTED') { $score -= 30 }
        if ($antivirus -ne 'ACTIVE') { $score -= 30 }
        if ($firewall -ne 'ENABLED') { $score -= 20 }
    }
    return @{
        metrics = $metrics
        posture = @{
            bitlocker_status = $bitlocker
            antivirus_status = $antivirus
            antivirus_name = $antivirusName
            firewall_status = $firewall
            security_score = $score
        }
    }
}

function Send-AgentBatch {
    param($Config)
    try {
        # N29: always replay exactly the same locally saved JSON until ACK.
        $stored = Invoke-SQLite -Query "SELECT batch_id, body_json, event_ids FROM telemetry_outbox WHERE status='pending' ORDER BY created_at ASC LIMIT 1;" -DatabasePath $QueueDb -AsJson
        $storedRows = @()
        if (-not [string]::IsNullOrWhiteSpace([string]$stored)) {
            $storedRows = @($stored | ConvertFrom-Json)
        }
        $batchId = $null
        $ids = @()
        $body = $null
        if ($storedRows.Count -gt 0) {
            $batchId = [string]$storedRows[0].batch_id
            $body = [string]$storedRows[0].body_json
            $ids = @($storedRows[0].event_ids | ConvertFrom-Json)
            if ($batchId -notmatch '^[0-9a-fA-F]{32}$' -or [string]::IsNullOrWhiteSpace($body)) {
                throw 'Invalid durable telemetry retry payload; retaining outbox'
            }
        } else {
            $pending = Invoke-SQLite -Query "SELECT id, kind, payload, sanitized, created_at FROM outbox WHERE status='pending' ORDER BY id ASC LIMIT 50;" -DatabasePath $QueueDb -AsJson
            $pendingRows = @()
            if (-not [string]::IsNullOrWhiteSpace([string]$pending)) {
                $pendingRows = @($pending | ConvertFrom-Json)
            }
            $queueInstanceId = if ($pendingRows.Count -gt 0) { Get-QueueInstanceId } else { $null }
            $events = @(
                foreach ($row in $pendingRows) {
                    @{
                        kind          = $row.kind
                        payload       = ($row.payload | ConvertFrom-Json)
                        sanitized     = [bool]$row.sanitized
                        client_msg_id = "${queueInstanceId}:$([long]$row.id)"
                        captured_at   = $row.created_at
                    }
                }
            )
            $ids = @($pendingRows | ForEach-Object { [long]$_.id })
            $batchId = [guid]::NewGuid().ToString('N')
            $snapshot = Get-FreshAgentSnapshot
            $body = @{
                batch_id      = $batchId
                hostname      = (Get-AgentHostname)
                os_version    = [System.Environment]::OSVersion.VersionString
                agent_version = (Get-InstalledAgentVersion)
                ip_address    = (Get-AgentIP)
                metrics       = $snapshot.metrics
                posture       = $snapshot.posture
                events        = @($events)
            } | ConvertTo-Json -Compress -Depth 12

            $escapedBody = $body.Replace("'", "''")
            $idsJson = ConvertTo-Json -InputObject @($ids) -Compress
            $escapedIds = $idsJson.Replace("'", "''")
            # The unique pending index prevents two concurrent service runs
            # from staging separate request IDs for the same outbox rows.
            Invoke-SQLite -Query "INSERT INTO telemetry_outbox (batch_id, body_json, event_ids) VALUES ('$batchId', '$escapedBody', '$escapedIds');" -DatabasePath $QueueDb | Out-Null
        }

        $cert = Get-RestCertificate -Config $Config
        $agentTok = Get-AgentToken -Config $Config
        $headers = @{
            "Authorization"  = "Bearer $agentTok"
            "X-Device-Token" = $agentTok
        }
        if ($cert) {
            $resp = Invoke-RestMethod -Uri $Config.endpoint -Method Post -Headers $headers -ContentType 'application/json' -Body $body -Certificate $cert
        } else {
            $resp = Invoke-RestMethod -Uri $Config.endpoint -Method Post -Headers $headers -ContentType 'application/json' -Body $body
        }

        # HTTP 2xx alone never acknowledges a local row or saved batch.
        $accepted = 0
        $acceptedProperty = if ($null -ne $resp) { $resp.PSObject.Properties['accepted'] } else { $null }
        if ($null -eq $resp -or [string]$resp.status -cne 'OK' -or
            [string]$resp.batch_id -cne $batchId -or
            $null -eq $acceptedProperty -or
            -not [int]::TryParse([string]$acceptedProperty.Value, [ref]$accepted) -or
            $accepted -ne $ids.Count) {
            throw "Server did not acknowledge batch $batchId and all $($ids.Count) events; retaining snapshot"
        }

        if ($ids.Count -gt 0) {
            $localIds = ($ids | ForEach-Object { [long]$_ }) -join ','
            Invoke-SQLite -Query "UPDATE outbox SET status='delivered' WHERE status='pending' AND id IN ($localIds);" -DatabasePath $QueueDb | Out-Null
        }
        Invoke-SQLite -Query "UPDATE telemetry_outbox SET status='delivered' WHERE status='pending' AND batch_id='$batchId';" -DatabasePath $QueueDb | Out-Null
        $script:FlushBackoff = 0
        Write-AgentLog "Uploaded durable batch $batchId; acknowledged $accepted queued events"
        return $accepted
    } catch {
        $script:FlushBackoff++
        $wait = Get-NextBackoffSleepSeconds -FailedConsecutive $script:FlushBackoff
        Write-AgentLog "Upload failed ($($_.Exception.Message)) - retaining durable snapshot/events; retry in ~$wait s"
        Invoke-QueueSleep -SleepSeconds ([Math]::Min($wait, 15))
        return 0
    }
}

# ---------------------------------------------------------------- queue hygiene (E2)

# Bounded outbox no matter what the collectors enqueue. Delivery is
# best-effort: rows that age out while delivered keep the DB small, and a
# runaway collector can't grow the queue without bound. Retention/caps are read
# lazily so agent.json overrides (queue_retention_days, max_outbox_rows) apply
# even though they ship after $Config is loaded.

function Get-QueueRetentionDays {
    if ($Config.queue_retention_days) { return [int]$Config.queue_retention_days }
    return 7
}

function Get-MaxOutboxRows {
    if ($Config.max_outbox_rows) { return [int]$Config.max_outbox_rows }
    return 5000
}

function Prune-Queue {
    # E2: drop delivered rows past retention + cap total rows (oldest first).
    try {
        $retention = Get-QueueRetentionDays
        Invoke-SQLite -Query "DELETE FROM outbox WHERE status='delivered' AND created_at < datetime('now', '-$retention days');" -DatabasePath $QueueDb | Out-Null
        $count = Invoke-SQLite -Query "SELECT COUNT(*) AS n FROM outbox;" -DatabasePath $QueueDb -AsJson 2>$null
        $total = 0
        if ($count -and $count.Trim()) { $total = [int]((($count | ConvertFrom-Json) | Select-Object -First 1).n) }
        $max = Get-MaxOutboxRows
        if ($total -gt $max) {
            $excess = $total - $max
            Invoke-SQLite -Query "DELETE FROM outbox WHERE id IN (SELECT id FROM outbox ORDER BY id ASC LIMIT $excess);" -DatabasePath $QueueDb | Out-Null
            Write-AgentLog "Outbox size cap: pruned $excess oldest rows (total was $total)"
        }
    }
    catch { Write-AgentLog "Queue prune skipped: $($_.Exception.Message)" }
}

# Exponential backoff w/ jitter. State persists across cycles within one agent
# process; the server's per-agent outbox is unbounded so the client pacing here
# is what stops a thundering herd when the endpoint is degraded or down.
$script:FlushBackoff = 0

function Get-NextBackoffSleepSeconds {
    param([int]$FailedConsecutive)
    $base = 30          # seconds
    $cap  = 900         # 15 min
    if ($FailedConsecutive -lt 1) { return 0 }
    $exp = [Math]::Min($base * [Math]::Pow(2, $FailedConsecutive - 1), $cap)
    # jitter ±30% so many agents with the same failure don't stay synchronized.
    $jit = 0.7 + (Get-Random -Minimum 0 -Maximum 100) / 100.0 * 0.6
    return [Math]::Min([Math]::Round($exp * $jit), $cap)
}

function Invoke-QueueSleep {
    param($SleepSeconds)
    if ($SleepSeconds -gt 0) {
        Write-AgentLog "Backing off $SleepSeconds s after failure"
        Start-Sleep -Seconds $SleepSeconds
    }
}

# ------------------------------------------------------------------ self-update (E3)

function Get-InstalledAgentVersion {
    # Source of truth: HKLM stamp the MSI wrote at install time. Falls back to
    # the bundled config (pre-E3 agents / non-MSI installs).
    $v = $Config.agent_version
    try {
        $regKey = 'HKLM:\SOFTWARE\ITToolkit\Agent'
        if (Test-Path $regKey) {
            $stamp = (Get-ItemProperty $regKey -ErrorAction SilentlyContinue).Installed
            if ($stamp) { $v = [string]$stamp }
        }
    }
    catch { }
    return $v
}

function Get-AgentUpdateInfo {
    param($Config)
    $hn = [uri]::EscapeDataString((Get-AgentHostname))
    $uri = "$(Get-CommandsApiRoot)/api/agent/update?hostname=$hn"
    try {
        $cert = Get-RestCertificate -Config $Config
        if ($cert) {
            return Invoke-RestMethod -Uri $uri -Method Get -Headers @{ Authorization = "Bearer $(Get-AgentToken -Config $Config)" } -Certificate $cert
        }
        else {
            return Invoke-RestMethod -Uri $uri -Method Get -Headers @{ Authorization = "Bearer $(Get-AgentToken -Config $Config)" }
        }
    }
    catch {
        Write-AgentLog "Update check failed: $($_.Exception.Message)"
        return $null
    }
}

function Update-AgentIfNeeded {
    param($Config)
    # P0: even a mutually authenticated server response is not independent
    # publisher approval. Untrusted TEMP MSI + elevated msiexec is forbidden
    # until a reviewed signed-release hash + certificate trust pipeline exists.
    Write-AgentLog 'AUTO_UPDATE_RELEASE_APPROVAL_REQUIRED: automatic MSI download and privileged installation are disabled; use an independently verified, signed MSI release'
    return $false
}

# ------------------------------------------------------------------ commands (P5)

function Get-CommandsApiRoot {
    # Strip any telemetry ingest path suffix to resolve base origin
    $ep = [string]$Config.endpoint
    return ($ep -replace '(/api/v1/ingest/telemetry|/api/ingest|/ingest)\s*$', '')
}

function Get-PendingCommands {
    param($Config)
    $hn = [uri]::EscapeDataString((Get-AgentHostname))
    $uri = "$(Get-CommandsApiRoot)/api/commands/poll?hostname=$hn"
    try {
        $cert = Get-RestCertificate -Config $Config
        $agentTok = Get-AgentToken -Config $Config
        $headers = @{ 
            "Authorization"  = "Bearer $agentTok"
            "X-Device-Token" = $agentTok 
        }
        if ($cert) {
            $resp = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -Certificate $cert
        }
        else {
            $resp = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
        }
        return @($resp)
    }
    catch {
        Write-AgentLog "Command poll failed: $($_.Exception.Message)"
        return @()
    }
}

# Each remote command must be validated with this endpoint's enrolled
# credential and tenant identity BEFORE any executable field is trusted.
function Resolve-VerifiedAgentCommand {
    param($Config, $Cmd)
    $tokenPath = Get-AgentTokenPath
    $identityPath = Join-Path (Split-Path $ConfigPath -Parent) 'agent.identity.json'
    if (-not $Cmd -or -not $Cmd.signed_content -or -not $Cmd.signature -or
        -not (Test-Path $tokenPath) -or -not (Test-Path $identityPath)) { return $null }
    try {
        $token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
        $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
        if (-not $token.StartsWith('itk_dev_') -or
            -not $identity.device_id -or -not $identity.tenant_id) { return $null }
        $content = [string]$Cmd.signed_content
        $sig = [string]$Cmd.signature
        if ($content.Length -gt 65536 -or $sig -cnotmatch '^[a-fA-F0-9]{64}$') { return $null }
        $h = New-Object System.Security.Cryptography.HMACSHA256
        try {
            $h.Key = [Text.Encoding]::UTF8.GetBytes($token)
            $expected = $h.ComputeHash([Text.Encoding]::UTF8.GetBytes("aaditech:agent-command:v1`n" + $content))
        } finally { $h.Dispose() }
        $diff = 0
        for ($i=0; $i -lt 32; $i++) {
            $diff = $diff -bor ([int]$expected[$i] -bxor [int][Convert]::ToByte($sig.Substring($i*2, 2), 16))
        }
        if ($diff -ne 0) { return $null }
        $signed = $content | ConvertFrom-Json
        if ([int]$signed.version -ne 1 -or
            [string]$signed.command_id -cne [string]$Cmd.id -or
            [string]$signed.device_id -cne [string]$identity.device_id -or
            [string]$signed.tenant_id -cne [string]$identity.tenant_id -or
            [string]$signed.hostname -ine (Get-AgentHostname) -or
            [string]::IsNullOrWhiteSpace([string]$signed.kind)) { return $null }
        $issued = [DateTimeOffset]::Parse([string]$signed.issued_at)
        $expires = [DateTimeOffset]::Parse([string]$signed.expires_at)
        $now = [DateTimeOffset]::UtcNow
        if ($now -lt $issued.AddMinutes(-1) -or $now -gt $expires -or
            $expires -le $issued -or ($expires - $issued).TotalMinutes -gt 5) { return $null }
        return [PSCustomObject]@{ id = $signed.command_id; kind = $signed.kind; payload = $signed.payload }
    } catch {
        Write-AgentLog "Rejected invalid signed command: $($_.Exception.Message)"
        return $null
    }
}

function Send-WakeOnLan {
    param([string]$Mac, [string]$TargetIp)
    $bytes = [byte[]]@(0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)
    $parts = $Mac -split '[:-]'
    if ($parts.Count -ne 6) { throw "Invalid MAC address: $Mac" }
    $macBytes = @($parts | ForEach-Object { [Convert]::ToByte($_, 16) })
    for ($i = 0; $i -lt 16; $i++) { $bytes += $macBytes }
    $client = New-Object System.Net.Sockets.UdpClient
    try {
        if ($TargetIp) { $client.Send($bytes, $bytes.Length, $TargetIp, 9) | Out-Null }
        else { $client.Send($bytes, $bytes.Length, '255.255.255.255', 9) | Out-Null }
    }
    finally { $client.Close() }
}

function Invoke-RemoteCommand {
    param($Config, $Cmd)
    $kind = $Cmd.kind
    $payload = $Cmd.payload
    switch ($kind) {
        'reboot' {
            # A signed command proves transport integrity, NOT user consent,
            # a maintenance window or authorized interruption approval.
            # Until that workflow exists, never reboot or mark it completed.
            return @{ status = 'failed'; output = 'REBOOT_APPROVAL_REQUIRED: no reboot executed; owner consent and maintenance approval required'; exit_code = 403 }
        }
        'wake' {
            try {
                Send-WakeOnLan -Mac $payload.mac -TargetIp $payload.ip
                return @{ status = 'completed'; output = "Wake-on-LAN sent to $($payload.mac)"; exit_code = 0 }
            }
            catch {
                return @{ status = 'failed'; output = $_.Exception.Message; exit_code = 1 }
            }
        }
        'run-script' {
            $script = $payload.script
            if (-not $script) { return @{ status = 'failed'; output = 'No script specified'; exit_code = 1 } }
            # C5: agent-side allowlist defense-in-depth. Even if a rogue server
            # (or a replayed/mutated command) asks for a script, only scripts the
            # operator allowlisted at deploy time run here.
            $allowed = @($Config.run_script_allowlist | Where-Object { $_ })
            if ($allowed.Count -eq 0 -or $allowed -notcontains $script) {
                return @{ status = 'failed'; output = "Script '$script' is not in the agent allowlist (empty or unauthorized)"; exit_code = 1 }
            }
            if ($script -match '\.\.' -or $script -match '^[/\\]' -or $script -match '^[A-Za-z]:') {
                return @{ status = 'failed'; output = "Invalid script path or path traversal detected: $script"; exit_code = 1 }
            }
            $path = [System.IO.Path]::GetFullPath((Join-Path $script:RepoRoot $script))
            $rootFullPath = [System.IO.Path]::GetFullPath($script:RepoRoot)
            if (-not $path.StartsWith($rootFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                return @{ status = 'failed'; output = "Path traversal escaping script root: $script"; exit_code = 1 }
            }
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return @{ status = 'failed'; output = "Script not found: $script"; exit_code = 1 } }
            try {
                $out = (& $path 2>&1 | Out-String)
                return @{ status = 'completed'; output = $out; exit_code = $LASTEXITCODE }
            }
            catch {
                return @{ status = 'failed'; output = $_.Exception.Message; exit_code = 1 }
            }
        }
        default { return @{ status = 'failed'; output = "Unknown command kind: $kind"; exit_code = 1 } }
    }
}

function Send-CommandResult {
    param($Config, $Context, $Row)
    # Re-read configuration/credential before every send. Reconfigured
    # identity or rotated token quarantines earlier rows, even on same host.
    try {
        $current = Get-CommandDeliveryContext $Config
        if ($current.binding -cne $Context.binding -or $Row.binding -cne $current.binding) { return }
        $id = ConvertTo-CommandUuid ([string]$Row.command_id)
        $binding = $current.binding
        Assert-CommandBinding $binding
        $body = [string]$Row.body
        if ($body.Length -gt 8192) { throw 'Invalid stored command result' }
        $data = $body | ConvertFrom-Json
        if ($data.status -cnotin @('completed','failed') -or $data.status -cne $Row.status -or
            $data.output -isnot [string] -or $null -eq $data.exit_code -or
            @($data.PSObject.Properties.Name).Count -ne 3) { throw 'Invalid stored command result' }
        $attempt = Invoke-SQLite -Query "UPDATE command_results_v3 SET last_attempt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE command_id='$id' AND binding='$binding' AND delivery='pending'; SELECT changes();" -DatabasePath $QueueDb
        if (($attempt -join '').Trim() -ne '1') { return }
        $headers = @{ Authorization="Bearer $($current.token)"; "X-Device-Token"=$current.token }
        $request = @{ Uri="$($current.origin)/api/commands/$id/result"; Method='Post'; Headers=$headers; ContentType='application/json'; Body=[Text.Encoding]::UTF8.GetBytes($body); MaximumRedirection=0; TimeoutSec=15; ErrorAction='Stop' }
        $cert = Get-RestCertificate -Config $Config
        if ($cert) { $request.Certificate = $cert }
        $reply = Invoke-RestMethod @request
        $completed = [DateTimeOffset]::MinValue
        if ($reply.ok -isnot [bool] -or -not $reply.ok -or
            $reply.id -cne $id -or $reply.status -cne $data.status -or
            $reply.duplicate -isnot [bool] -or
            -not [DateTimeOffset]::TryParse([string]$reply.completed_at, [ref]$completed)) {
            throw 'No matching authoritative command result receipt'
        }
        # The server's exact-replay contract allows a lost ACK to be retried.
        # A malformed reply, HTTP error or DB failure cannot mark delivery.
        $changed = Invoke-SQLite -Query "UPDATE command_results_v3 SET delivery='acknowledged' WHERE command_id='$id' AND binding='$binding' AND delivery='pending'; SELECT changes();" -DatabasePath $QueueDb
        if (($changed -join '').Trim() -eq '1') { Write-AgentLog "Acknowledged durable command result $id" }
    } catch {
        Write-AgentLog 'Command result remains pending; transport or receipt verification failed'
    }
}

function Send-PendingCommandResults {
    param($Config)
    try {
        $context = Get-CommandDeliveryContext $Config
        $binding = $context.binding
        Assert-CommandBinding $binding
        $json = Invoke-SQLite -Query "SELECT command_id,binding,status,body FROM command_results_v3 WHERE binding='$binding' AND delivery='pending' ORDER BY last_attempt,command_id LIMIT 10;" -DatabasePath $QueueDb -AsJson
        if (-not [string]::IsNullOrWhiteSpace($json)) {
            foreach ($row in @($json | ConvertFrom-Json)) {
                Send-CommandResult -Config $Config -Context $context -Row $row
            }
        }
    } catch {
        Write-AgentLog 'Command result retry skipped: enrolled delivery context or ledger unavailable'
    }
}

function Invoke-VerifiedCommandOnce {
    param($Config, $Cmd)
    # Compare context before/after signature verification, then claim once.
    # No unverified outer ID is ever used in SQL or result routing.
    try {
        $context = Get-CommandDeliveryContext $Config
        $trusted = Resolve-VerifiedAgentCommand -Config $Config -Cmd $Cmd
        if (-not $trusted) { return }
        if ((Get-CommandDeliveryContext $Config).binding -cne $context.binding) { return }
        $id = ConvertTo-CommandUuid ([string]$trusted.id)
        if (-not (Try-ClaimVerifiedCommand -CommandId $id -Binding $context.binding)) {
            Write-AgentLog "Command $id has an existing or uncertain prior claim; refusing re-execution"
            return
        }
        try {
            $result = Invoke-RemoteCommand -Config $Config -Cmd $trusted
        } catch {
            $result = @{ status='failed'; output='Command execution failed; inspect local logs'; exit_code=1 }
        }
        $normalized = ConvertTo-CommandResult $result
        Record-ExecutedCommand -CommandId $id -Binding $context.binding -Result $normalized
    } catch {
        Write-AgentLog 'Command lifecycle could not be safely completed; no automatic retry of execution'
    }
}

# ------------------------------------------------------------------ main

Import-ToolkitModules
Initialize-Queue
$Config = Read-AgentConfig

Write-AgentLog "Agent cycle start (endpoint: $($Config.endpoint))"

# mTLS: fetch the client cert once before the first endpoint call.
$null = Ensure-ClientCert -Config $Config

# N27: full inventory/upgrade work can stay on the installed 30-minute
# schedule while lightweight measured telemetry stays fresher than the server's
# 15-minute freshness window. No extra scripts or elevated operations run here.
function Wait-ForNextAgentCycle {
    param($Config, [int]$Seconds, [bool]$SkipTelemetry = $false)
    $remaining = [Math]::Max(0, $Seconds)
    while ($remaining -gt 0) {
        $step = [Math]::Min(300, $remaining)  # 5-minute evidence/heartbeat cadence
        Start-Sleep -Seconds $step
        $remaining -= $step
        if ($remaining -gt 0) {
            try { $null = Send-AgentHeartbeat -Config $Config }
            catch { Write-AgentLog "Inter-cycle heartbeat failed: $($_.Exception.Message)" }
            if (-not $SkipTelemetry) {
                # Send-AgentBatch also handles events=[], keeping empty queues
                # from suppressing authenticated CPU/RAM/disk snapshots.
                $null = Send-AgentBatch -Config $Config
            }
        }
    }
}

do {
    # E2: keep the outbox bounded (retention + size cap) once per cycle.
    Prune-Queue

    # E1: heartbeat every cycle — an idle agent (empty queue, no commands)
    # still updates last_seen, so the fleet view + agent-offline rule stay correct.
    try { $null = Send-AgentHeartbeat -Config $Config }
    catch { Write-AgentLog "Heartbeat failed (will retry next cycle): $($_.Exception.Message)" }

    # E3: staged self-upgrade. Runs best-effort each cycle; skips network work
    # when the server reports the installed version is already current.
    if (-not $CollectOnly -and -not $FlushOnly) {
        $null = Update-AgentIfNeeded -Config $Config
    }

    if (-not $FlushOnly) {
        $ran = Invoke-AgentCollection -Config $Config
        Write-AgentLog "Collected: $($ran -join ', ')"
    }

    if (-not $CollectOnly) {
        $sent = Send-AgentBatch -Config $Config
        Write-AgentLog "Sent: $sent events"
    }

    if (-not $FlushOnly -and -not $CollectOnly) {
        $cmds = Get-PendingCommands -Config $Config
        foreach ($cmd in $cmds) {
            Invoke-VerifiedCommandOnce -Config $Config -Cmd $cmd
        }
        if (@($cmds).Count -gt 0) { Write-AgentLog "Received $($cmds.Count) command(s); outcomes require durable evidence" }
    }

    if (-not $CollectOnly) { Send-PendingCommandResults -Config $Config }

    Write-AgentLog "Agent cycle complete"

    if ($LoopMinutes -gt 0) {
        # E2: jitter the inter-cycle sleep (±15%) so agents that boot together or
        # share an interval don't stay synchronized (thundering-herd prevention).
        $base = $LoopMinutes * 60
        $jitterPct = (Get-Random -Minimum -15 -Maximum 15) / 100.0
        $cycle = [Math]::Max(1, [Math]::Round($base * (1 + $jitterPct)))
        Wait-ForNextAgentCycle -Config $Config -Seconds $cycle -SkipTelemetry ([bool]$CollectOnly)
    }
} while ($LoopMinutes -gt 0)
