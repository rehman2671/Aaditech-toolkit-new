#Requires -Version 5.1
<#
N32: generate a REDACTED integrity manifest of offline, recovered and optional
Stage31 Windows machine acceptance reports. NEVER copies agent configuration,
device tokens, SQLite request payloads or tenant credentials.
This is an evidence index for operator review, NOT production certification.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
  [Parameter(Mandatory=$true)][string]$BundlePath,
  [string]$WindowsPreflightReport
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not (Test-Path -LiteralPath $EvidenceDirectory -PathType Container)) {
  throw 'Existing N32 evidence directory required.'
}
if (Test-Path -LiteralPath $BundlePath) { throw 'Evidence bundle already exists; refusing overwrite.' }
$offlineFile = Join-Path $EvidenceDirectory 'stage32-offline.json'
$recoveredFile = Join-Path $EvidenceDirectory 'stage32-recovered.json'
if (-not (Test-Path -LiteralPath $offlineFile -PathType Leaf) -or
    -not (Test-Path -LiteralPath $recoveredFile -PathType Leaf)) {
  throw 'Both offline and recovered evidence are required.'
}
try {
  $offline = Get-Content -LiteralPath $offlineFile -Raw | ConvertFrom-Json -ErrorAction Stop
  $recovered = Get-Content -LiteralPath $recoveredFile -Raw | ConvertFrom-Json -ErrorAction Stop
} catch { throw 'Unreadable or invalid N32 evidence.' }
if ($offline.schema -cne 'aaditech-stage32-offline-v1' -or
    $recovered.schema -cne 'aaditech-stage32-recovered-v1' -or
    $offline.phase -cne 'OFFLINE_OPERATOR_ATTESTED' -or
    $recovered.phase -cne 'LOCAL_SQLITE_ACK_OBSERVED' -or
    $recovered.local_ack_observed -ne $true -or
    $offline.certified_for_production -ne $false -or
    $recovered.certified_for_production -ne $false -or
    $offline.server_receipt_independently_verified -ne $false -or
    $recovered.server_receipt_independently_verified -ne $false -or
    $offline.run_id -cne $recovered.run_id -or
    $offline.batch_id -cne $recovered.batch_id -or
    $offline.payload_sha256 -cne $recovered.payload_sha256 -or
    $offline.queue_identity_sha256 -cne $recovered.queue_identity_sha256 -or
    $offline.payload_sha256 -notmatch '^[0-9a-f]{64}$' -or
    $offline.queue_identity_sha256 -notmatch '^[0-9a-f]{64}$' -or
    $recovered.offline_evidence_sha256 -cne
      (Get-FileHash -LiteralPath $offlineFile -Algorithm SHA256).Hash.ToLowerInvariant()) {
  throw 'Offline/recovered report inconsistency or fabricated certification.'
}
$artifacts = [System.Collections.Generic.List[object]]::new()
foreach ($f in @($offlineFile,$recoveredFile)) {
  $artifacts.Add([pscustomobject]@{
    kind = if ($f -ceq $offlineFile) { 'offline_local' } else { 'recovered_local' }
    sha256 = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()
  })
}
$preflightStatus = 'NOT_PROVIDED'
if ($WindowsPreflightReport) {
  if (-not (Test-Path -LiteralPath $WindowsPreflightReport -PathType Leaf)) {
    throw 'Stage31 Windows report is missing.'
  }
  try { $preflight = Get-Content -LiteralPath $WindowsPreflightReport -Raw | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'Invalid Stage31 Windows preflight JSON.' }
  if ($preflight.schema -cne 'aaditech-stage31-windows-v1' -or
      $preflight.certified_for_production -ne $false -or
      $preflight.decision -notin @('BLOCKED','EXTERNAL_ACCEPTANCE_REQUIRED')) {
    throw 'Unrecognized or incorrectly certified Windows preflight.'
  }
  $preflightStatus = [string]$preflight.decision
  $artifacts.Add([pscustomobject]@{
    kind = 'windows_preflight'
    sha256 = (Get-FileHash -LiteralPath $WindowsPreflightReport -Algorithm SHA256).Hash.ToLowerInvariant()
  })
}
$bundle = [ordered]@{
  schema = 'aaditech-stage32-customer-evidence-bundle-v1'
  created_utc = [DateTime]::UtcNow.ToString('o')
  run_id = [string]$offline.run_id
  local_sqlite_ack_evidence = 'HASHES_MATCH_LOCAL_DELIVERED'
  windows_preflight = $preflightStatus
  external_network_partition_proof = 'REQUIRES_OPERATOR_EVIDENCE'
  authenticated_server_receipt_proof = 'REQUIRES_INDEPENDENT_READ_ONLY_DB_VERIFICATION'
  production_backup_restore = 'REQUIRES_CUSTOMER_APPROVAL'
  public_signed_installer = 'REQUIRES_PUBLISHER_APPROVAL'
  live_integrations = 'NOT_VERIFIED'
  production_certified = $false
  artifacts = @($artifacts)
}
$dir = Split-Path -Parent $BundlePath
if ($dir -and -not (Test-Path -LiteralPath $dir -PathType Container)) {
  throw 'Bundle destination directory does not exist.'
}
$bytes = [Text.UTF8Encoding]::new($false).GetBytes(($bundle | ConvertTo-Json -Depth 8) + [Environment]::NewLine)
try {
  $stream = [IO.File]::Open($BundlePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush() }
  finally { $stream.Dispose() }
} finally { [Array]::Clear($bytes,0,$bytes.Length) }
Write-Host 'N32 evidence bundle created: redacted SHA256 manifest; independent production gates pending.'
