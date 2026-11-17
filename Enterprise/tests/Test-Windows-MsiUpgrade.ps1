#Requires -Version 5.1
<#
.SYNOPSIS
  CI-only Windows Installer major-upgrade state preservation rehearsal.
.DESCRIPTION
  On a disposable elevated GitHub Windows runner, builds a second diagnostic
  revision from the same staged files, upgrades the installed product, checks
  that tenant/server configuration remains intact, and removes the candidate.
  Does not publish either unsigned diagnostic package.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or
    -not $env:RUNNER_TEMP) { throw 'MSI upgrade rehearsal requires a disposable Windows Actions runner.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'MSI upgrade rehearsal requires an elevated Windows runner.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$buildOut = Join-Path $repoRoot 'Enterprise\agent\build\out'
$wixDir = Join-Path $repoRoot 'Enterprise\agent\wix'
$meta = Get-Content (Join-Path $repoRoot 'Enterprise\agent\agent-version.json') -Raw | ConvertFrom-Json
$baseMsi = Get-ChildItem -Path $buildOut -Filter 'IT-Toolkit-Agent-*.msi' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $baseMsi) { throw 'Base MSI missing; build it before the upgrade test.' }
$parts = ([string]$meta.agent_version).Split('.')
if ($parts.Count -ne 3) { throw 'Invalid three-part agent version metadata' }
$baseBuild = ([int]$parts[2] * 1000) + [int]$meta.msi_revision
if ($baseBuild -ge 65535) { throw 'Upgrade test cannot exceed Windows Installer product version limit.' }
$baseVersion = ('{0}.{1}.{2}' -f $parts[0], $parts[1], $baseBuild)
$candidateVersion = ('{0}.{1}.{2}' -f $parts[0], $parts[1], ($baseBuild + 1))
$interval = [int]$meta.interval_minutes

function Read-MsiProperty([string]$File, [string]$Name) {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($File, 0)
    $view = $database.OpenView("SELECT Value FROM Property WHERE Property = '$Name'")
    try {
        $null = $view.Execute()
        $row = $view.Fetch()
        if (-not $row) { throw "MSI property missing: $Name" }
        $value = [string]$row.StringData(1)
        return $value
    } finally { $null = $view.Close() }
}
$baseVersionActual = [string](Read-MsiProperty $baseMsi.FullName 'ProductVersion')
Write-Host "MSI upgrade test base version: actual=<$baseVersionActual>, expected=<$baseVersion>"
if ($baseVersionActual -cne $baseVersion) {
    throw "Base MSI ProductVersion '$baseVersionActual' differs from '$baseVersion'."
}

$wix = Get-Command wix -ErrorAction SilentlyContinue
if (-not $wix) {
    $env:Path = "$env:USERPROFILE\.dotnet\tools;$env:Path"
    $wix = Get-Command wix -ErrorAction Stop
}
$upgradeMsi = Join-Path $env:RUNNER_TEMP 'itk-diagnostic-major-upgrade.msi'
Push-Location $wixDir
try {
    & $wix.Source build -arch x64 'Agent.wxs' -o $upgradeMsi `
        -d "AgentVersion=$candidateVersion" -d "AgentInterval=$interval"
    if ($LASTEXITCODE -ne 0) { throw "WiX upgrade candidate build failed: $LASTEXITCODE" }
} finally { Pop-Location }
if ((Read-MsiProperty $upgradeMsi 'ProductVersion') -cne $candidateVersion) {
    throw 'Diagnostic upgrade MSI ProductVersion is incorrect.'
}
$oldProduct = Read-MsiProperty $baseMsi.FullName 'ProductCode'
$newProduct = Read-MsiProperty $upgradeMsi 'ProductCode'
if ($oldProduct -eq $newProduct) { throw 'MajorUpgrade requires distinct ProductCode values.' }

$logs = Join-Path $env:RUNNER_TEMP 'itk-msi-upgrade-rehearsal'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$runtimeDir = Join-Path $env:ProgramData 'ITToolkit-Agent'
$configPath = Join-Path $runtimeDir 'agent.json'
$installedWizard = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'IT-Toolkit\Configure-Agent.ps1'
$token = 'ci-upgrade-bootstrap-only-123456789012345'
$endpoint = 'https://upgrade-test.invalid.example'
$installed = $false
$cleanupMsi = $baseMsi.FullName
$cleanupFailure = ''
function Invoke-Msi([string]$mode, [string]$msi, [string]$logFile) {
    $args = "$mode `"$msi`" /qn /norestart REBOOT=ReallySuppress /l*v `"$logFile`""
    $proc = Start-Process msiexec.exe -ArgumentList $args -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "msiexec $mode failed (exit $($proc.ExitCode)); log: $logFile"
    }
}
try {
    Invoke-Msi '/i' $baseMsi.FullName (Join-Path $logs 'install-base.log')
    $installed = $true
    if (-not (Test-Path -LiteralPath $installedWizard -PathType Leaf)) {
        throw 'Base MSI did not install the expected setup wizard.'
    }
    $sec = ConvertTo-SecureString -String $token -AsPlainText -Force
    try {
        & $installedWizard -ServerUrl $endpoint -EnrollmentToken $sec `
            -ConfigPath $configPath -NonInteractive | Out-Null
    } finally { $sec.Dispose() }
    $before = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($before.token -cne $token -or $before.endpoint -cne "$endpoint/api/v1/ingest/telemetry" -or $before.needs_setup) {
        throw 'Test fixture could not configure the installed agent.'
    }

    # A registered device may have its own identity and token already
    # provisioned; a major MSI upgrade must not wipe or rotate these.
    $deviceTokenFile = Join-Path $runtimeDir 'agent.token'
    $identityFile = Join-Path $runtimeDir 'agent.identity.json'
    $deviceToken = 'itk_dev_ci_upgraded_device_credential'
    [IO.File]::WriteAllText($deviceTokenFile, $deviceToken)
    [IO.File]::WriteAllText($identityFile, '{"device_id":"ci-device","tenant_id":"ci-tenant","device_uid":"ci-uid"}')

    # N30: use sqlite3.exe from the installed MSI, not just a file sentinel.
    # Prove queue instance identity, exact HTTP JSON, pending local events
    # survive the genuine Windows Installer major upgrade.
    $sqliteCli = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'IT-Toolkit\sqlite3.exe'
    if (-not (Test-Path -LiteralPath $sqliteCli -PathType Leaf)) {
        throw 'Base MSI did not install bundled sqlite3.exe'
    }
    $queueDb = Join-Path $runtimeDir 'queue.sqlite3'
    $queueId = [guid]::NewGuid().ToString('N')
    $batchId = [guid]::NewGuid().ToString('N')
    $eventId = [int](Get-Random -Minimum 1000000 -Maximum 2000000000)
    $anotherEventId = $eventId + 1
    $body = @{
        batch_id = $batchId
        hostname = 'N30-TEST'
        metrics = @{ cpu = @{ utilization_pct = 0 }; ram = @{ utilization_pct = 35 }; disk = @{ free_gb = 0 } }
        posture = @{ firewall_status = 'UNKNOWN' }
        events = @(@{ kind = 'n30_test'; client_msg_id = "${queueId}:$eventId"; payload = @{ disk = 0 } })
    } | ConvertTo-Json -Depth 10 -Compress
    $safeBody = $body.Replace("'", "''")
    $eventIds = "[$eventId]"
    # All tables and indexes mirror actual Initialize-Queue in Agent-Collect.
    $createQueue = @"
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL,
  sanitized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS queue_identity (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  instance_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telemetry_outbox (
  batch_id TEXT PRIMARY KEY, body_json TEXT NOT NULL, event_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_pending
  ON telemetry_outbox (status) WHERE status='pending';
INSERT OR IGNORE INTO queue_identity(singleton_id,instance_id) VALUES(1,'$queueId');
INSERT INTO outbox(id,kind,payload,sanitized,status)
  VALUES($eventId,'n30_test','{"disk":0}',1,'pending');
INSERT INTO outbox(id,kind,payload,sanitized,status)
  VALUES($anotherEventId,'n30_newer','{"disk":15}',1,'pending');
INSERT INTO telemetry_outbox(batch_id,body_json,event_ids,status)
  VALUES('$batchId','$safeBody','$eventIds','pending');
COMMIT;
"@
    $seedOutput = & $sqliteCli -batch $queueDb $createQueue 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Could not stage real SQLite in-flight queue: $seedOutput" }

    function Assert-QueueBeforeAndAfterUpgrade([string]$Phase) {
        $sql = @"
SELECT json_object(
  'integrity',(SELECT integrity_check FROM pragma_integrity_check LIMIT 1),
  'instance',(SELECT instance_id FROM queue_identity WHERE singleton_id=1),
  'body',(SELECT body_json FROM telemetry_outbox WHERE batch_id='$batchId' AND status='pending'),
  'ids',(SELECT event_ids FROM telemetry_outbox WHERE batch_id='$batchId' AND status='pending'),
  'pending',(SELECT COUNT(*) FROM outbox WHERE id IN ($eventId,$anotherEventId) AND status='pending'),
  'staged',(SELECT COUNT(*) FROM telemetry_outbox WHERE status='pending')
);
"@
        $rows = & $sqliteCli -batch $queueDb $sql 2>&1
        if ($LASTEXITCODE -ne 0) { throw "$Phase: SQLite read failed: $rows" }
        $state = ([string]($rows -join '') | ConvertFrom-Json)
        if ($state.integrity -cne 'ok' -or
            $state.instance -cne $queueId -or
            $state.body -cne $body -or
            $state.ids -cne $eventIds -or
            [int]$state.pending -ne 2 -or [int]$state.staged -ne 1) {
            throw "$Phase: queue UUID, exact pending HTTP JSON or unacknowledged events differ"
        }
    }
    Assert-QueueBeforeAndAfterUpgrade 'before major upgrade'

    Invoke-Msi '/i' $upgradeMsi (Join-Path $logs 'upgrade.log')
    $cleanupMsi = $upgradeMsi

    $after = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($after.endpoint -cne $before.endpoint -or $after.token -cne $token -or
        $after.enroll_url -cne $before.enroll_url -or $after.needs_setup) {
        throw 'Major MSI upgrade replaced the previously configured HTTPS server/tenant bootstrap settings.'
    }
    if (-not (Test-Path -LiteralPath $deviceTokenFile -PathType Leaf) -or
        -not (Test-Path -LiteralPath $identityFile -PathType Leaf)) {
        throw 'Major MSI upgrade discarded enrolled device credentials or tenant identity.'
    }
    if ((Get-Content -LiteralPath $deviceTokenFile -Raw) -cne $deviceToken) {
        throw 'Major MSI upgrade unexpectedly rotated the enrolled device credential.'
    }
    if (-not (Test-Path -LiteralPath $queueDb -PathType Leaf)) {
        throw 'Major MSI upgrade erased the in-flight SQLite queue file'
    }
    if (-not (Test-Path -LiteralPath $sqliteCli -PathType Leaf)) {
        throw 'Major MSI upgrade removed sqlite3.exe required for retry'
    }
    Assert-QueueBeforeAndAfterUpgrade 'after major upgrade'
    Write-Host 'N30 PASS: real SQLite integrity, persistent queue UUID, pending outbox and exact JSON survived major upgrade.'
    if (-not (Get-ScheduledTask -TaskName 'ITToolkitAgent' -ErrorAction SilentlyContinue)) {
        throw 'Major MSI upgrade removed the scheduled agent task.'
    }
    Write-Host "Major MSI upgrade $baseVersion -> $candidateVersion passed and retained HTTPS/tenant/device configuration."
}
finally {
    if ($installed) {
        try {
            Invoke-Msi '/x' $cleanupMsi (Join-Path $logs 'uninstall-upgraded.log')
            if (Get-ScheduledTask -TaskName 'ITToolkitAgent' -ErrorAction SilentlyContinue) {
                $cleanupFailure = 'Major-upgrade uninstall left scheduled task registered.'
            }
        } catch {
            $cleanupFailure = $_.Exception.Message
        }
    }
}
if ($cleanupFailure) { throw $cleanupFailure }
Write-Host 'Upgraded MSI uninstall and task cleanup passed.'
