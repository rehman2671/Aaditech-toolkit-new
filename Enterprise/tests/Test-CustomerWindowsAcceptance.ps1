#Requires -Version 5.1
# N31: read-only customer-machine acceptance; never sends or displays credentials.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ReportPath,
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'IT-Toolkit'),
  [string]$ConfigPath = (Join-Path $env:ProgramData 'ITToolkit-Agent\agent.json'),
  [string]$QueueDb = (Join-Path $env:ProgramData 'ITToolkit-Agent\queue.sqlite3'),
  [switch]$NetworkProbe,
  [string]$ApprovedPublisherThumbprint
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (Test-Path -LiteralPath $ReportPath) { throw 'Refusing to overwrite existing acceptance report.' }
$checks = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Id,[string]$State,[string]$Note) {
  $checks.Add([pscustomobject]@{id=$Id;state=$State;note=$Note})
}
$runningOnWindows = $env:OS -eq 'Windows_NT'
if ($runningOnWindows) { Add-Check 'platform' 'PASS' 'Windows detected.' }
else { Add-Check 'platform' 'BLOCKED' 'Run on actual customer Windows.' }
$exe = Join-Path $InstallRoot 'IT-Toolkit-Agent.exe'
$sqlite = Join-Path $InstallRoot 'sqlite3.exe'
if (Test-Path -LiteralPath $exe -PathType Leaf) {
  Add-Check 'agent_binary' 'PASS' 'Installed worker EXE found.'
} else { Add-Check 'agent_binary' 'BLOCKED' 'Agent installer not present.' }
$origin = $null
try {
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $uri = $null
  $valid = [uri]::TryCreate([string]$config.endpoint,[UriKind]::Absolute,[ref]$uri)
  if (-not $valid -or $uri.Scheme -cne 'https' -or $uri.UserInfo -or
      $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -cne '/api/v1/ingest/telemetry' -or
      $config.needs_setup -ne $false) { throw 'Invalid setup' }
  $origin = $uri.GetLeftPart([UriPartial]::Authority)
  Add-Check 'setup' 'PASS' 'Configured HTTPS endpoint is valid; secret values redacted.'
} catch { Add-Check 'setup' 'BLOCKED' 'HTTPS setup incomplete or invalid.' }
$runtime = Split-Path $QueueDb -Parent
try {
  $identity = Get-Content -LiteralPath (Join-Path $runtime 'agent.identity.json') -Raw | ConvertFrom-Json
  $tokenFile = Join-Path $runtime 'agent.token'
  if (-not $identity.tenant_id -or -not $identity.device_id -or
      -not (Test-Path -LiteralPath $tokenFile -PathType Leaf) -or
      (Get-Item -LiteralPath $tokenFile).Length -lt 1) { throw 'Unprovisioned device' }
  Add-Check 'enrollment' 'PASS' 'Local enrolled identity and token file exist; no values recorded.'
} catch { Add-Check 'enrollment' 'BLOCKED' 'Enrolled device identity/token missing.' }
if ($runningOnWindows) {
  try {
    $task = Get-ScheduledTask -TaskName 'ITToolkitAgent' -ErrorAction Stop
    if ([string]$task.Principal.UserId -notmatch '(?i)(NETWORK SERVICE|S-1-5-20)$') {
      throw 'Wrong task principal'
    }
    Add-Check 'task_identity' 'PASS' 'Scheduled task uses NETWORK SERVICE.'
  } catch { Add-Check 'task_identity' 'BLOCKED' 'Scheduled task absent or not NETWORK SERVICE.' }
}
try {
  if (-not (Test-Path -LiteralPath $sqlite -PathType Leaf) -or
      -not (Test-Path -LiteralPath $QueueDb -PathType Leaf)) { throw 'SQLite files absent' }
  # -readonly: do not accidentally create queue; never select payload or token.
  $sql = "PRAGMA integrity_check; SELECT COUNT(*) FROM outbox WHERE status='pending'; SELECT COUNT(*) FROM telemetry_outbox WHERE status='pending'; SELECT COUNT(*) FROM queue_identity WHERE singleton_id=1 AND length(instance_id)=32;"
  $result = @(& $sqlite -readonly -batch $QueueDb $sql 2>$null)
  $pending=0; $batches=0
  if ($LASTEXITCODE -ne 0 -or $result.Count -ne 4 -or [string]$result[0] -cne 'ok' -or
      [string]$result[3] -cne '1' -or
      -not [int]::TryParse([string]$result[1],[ref]$pending) -or
      -not [int]::TryParse([string]$result[2],[ref]$batches)) { throw 'Queue integrity failed' }
  Add-Check 'durable_queue' 'PASS' 'SQLite integrity, queue UUID and pending counts verified.'
} catch { Add-Check 'durable_queue' 'BLOCKED' 'SQLite persistent queue missing, corrupt or unreadable.' }
if (-not $ApprovedPublisherThumbprint) {
  Add-Check 'publisher' 'PENDING' 'Approved publisher thumbprint unavailable.'
} elseif ($ApprovedPublisherThumbprint -notmatch '^[a-fA-F0-9]{40}$') {
  Add-Check 'publisher' 'BLOCKED' 'Approved publisher pin must be 40 hex digits.'
} else {
  try {
    $sig = Get-AuthenticodeSignature -LiteralPath $exe
    if ($sig.Status -ne 'Valid' -or -not $sig.SignerCertificate -or
        $sig.SignerCertificate.Thumbprint.ToUpperInvariant() -cne $ApprovedPublisherThumbprint.ToUpperInvariant() -or
        -not $sig.TimeStamperCertificate) { throw 'Untrusted signer' }
    Add-Check 'publisher' 'PASS' 'Trusted timestamped Authenticode EXE publisher.'
  } catch { Add-Check 'publisher' 'BLOCKED' 'Signed EXE publisher verification failed.' }
}
# N38 protective stop: the previous PowerShell HTTP helper performed
# a second, unpinned DNS resolution and could follow a redirect to an internal
# address despite a syntactically valid HTTPS configuration. Until a
# separately reviewed, authenticated and connection-pinned Windows transport
# exists, NEVER execute HTTP or DNS from this customer acceptance script.
# The N37 Hostinger checker is a separate operator-authorized Linux workflow,
# not evidence that the Windows endpoint probe is safe or certified.
if ($NetworkProbe) {
  Add-Check 'public_https' 'BLOCKED' 'Windows live probe disabled: DNS pinning, no-redirect transport and independent approval required.'
} else {
  Add-Check 'public_https' 'PENDING' 'No network probe performed; Windows live path disabled pending secured transport certification.'
}
Add-Check 'physical_lost_ack' 'PENDING' 'Operator must witness offline/reconnect duplicate-free server ACK.'
Add-Check 'offsite_restore' 'PENDING' 'Customer encrypted backup and offsite restore need independent approval.'
Add-Check 'signed_msi' 'PENDING' 'Approved public signed MSI publication needs independent evidence.'
$blockers = @($checks | Where-Object { $_.state -eq 'BLOCKED' }).Count
$pending = @($checks | Where-Object { $_.state -eq 'PENDING' }).Count
$decision = if ($blockers -gt 0) { 'BLOCKED' } else { 'EXTERNAL_ACCEPTANCE_REQUIRED' }
$parent = Split-Path -Parent $ReportPath
if ($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'Report parent missing.' }
$reportData = [pscustomobject]@{
  schema='aaditech-stage31-windows-v1'
  timestamp_utc=[DateTime]::UtcNow.ToString('o')
  decision=$decision
  blockers=$blockers
  pending=$pending
  certified_for_production=$false
  checks=@($checks)
}
# CreateNew refuses even a concurrently created file/symlink. Set-Content
# would truncate a file that appeared after the earlier Test-Path check.
$payload = $reportData | ConvertTo-Json -Depth 6
$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($payload + [Environment]::NewLine)
$stream = [System.IO.File]::Open($ReportPath, [System.IO.FileMode]::CreateNew,
  [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush($true)
} finally { $stream.Dispose() }
Write-Host "N31 Windows preflight $decision; $blockers blockers, $pending external gates."
Write-Host 'Report redacted: no credential, identity data or queue body printed or transmitted.'
if ($blockers -gt 0) { exit 1 }
exit 0
