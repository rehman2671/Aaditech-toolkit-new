# Stage N32 offline-only negative / redaction / tamper regression.
# No real customer data, SQLite, network, scheduled task or MSI side effects.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$collector = Join-Path $PSScriptRoot 'Invoke-Stage32CustomerReplayAcceptance.ps1'
$bundler = Join-Path $PSScriptRoot 'New-Stage32CustomerEvidenceBundle.ps1'
$temp = Join-Path $env:RUNNER_TEMP ('n32-fixture-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
function Assert-Blocked([scriptblock]$Operation, [string]$Message) {
  $blocked = $false
  try { & $Operation | Out-Null } catch { $blocked = $true }
  if (-not $blocked) { throw "N32 failed to block: $Message" }
}
try {
  $fakeDb = Join-Path $temp 'queue.sqlite3'
  $fakeSqlite = Join-Path $temp 'sqlite3.exe'
  Assert-Blocked {
    & $collector -Phase Offline -EvidenceDirectory $temp -QueueDb $fakeDb -SqliteExe $fakeSqlite
  } 'missing explicit operator confirmation'
  Assert-Blocked {
    & $collector -Phase Recovered -EvidenceDirectory $temp -QueueDb $fakeDb -SqliteExe $fakeSqlite -OperatorConfirmedReconnect
  } 'missing actual queue and offline report'
  if (Test-Path (Join-Path $temp 'stage32-offline.json')) {
    throw 'No evidence must be created on rejected inputs.'
  }

  $run = [guid]::NewGuid().ToString('N')
  $batchId = [guid]::NewGuid().ToString('N')
  $sha = 'a' * 64
  $queueHash = 'b' * 64
  $offlinePath = Join-Path $temp 'stage32-offline.json'
  $recoveredPath = Join-Path $temp 'stage32-recovered.json'
  $preflightPath = Join-Path $temp 'stage31.json'
  $bundlePath = Join-Path $temp 'bundle.json'
  $fakeSecret = 'N32-SECRET-DO-NOT-INCLUDE-IN-BUNDLE'
  [pscustomobject]@{
    schema='aaditech-stage32-offline-v1'
    run_id=$run
    phase='OFFLINE_OPERATOR_ATTESTED'
    batch_id=$batchId
    payload_sha256=$sha
    queue_identity_sha256=$queueHash
    event_ids_sha256=('c' * 64)
    in_flight_events=1
    server_receipt_independently_verified=$false
    certified_for_production=$false
  } | ConvertTo-Json | Set-Content -LiteralPath $offlinePath -Encoding utf8
  $offlineHash = (Get-FileHash $offlinePath -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    schema='aaditech-stage32-recovered-v1'
    run_id=$run
    phase='LOCAL_SQLITE_ACK_OBSERVED'
    batch_id=$batchId
    payload_sha256=$sha
    queue_identity_sha256=$queueHash
    offline_evidence_sha256=$offlineHash
    local_ack_observed=$true
    server_receipt_independently_verified=$false
    certified_for_production=$false
  } | ConvertTo-Json | Set-Content -LiteralPath $recoveredPath -Encoding utf8
  [pscustomobject]@{
    schema='aaditech-stage31-windows-v1'
    decision='EXTERNAL_ACCEPTANCE_REQUIRED'
    certified_for_production=$false
    private_config=$fakeSecret
  } | ConvertTo-Json | Set-Content -LiteralPath $preflightPath -Encoding utf8
  & $bundler -EvidenceDirectory $temp -BundlePath $bundlePath -WindowsPreflightReport $preflightPath
  $text = Get-Content -LiteralPath $bundlePath -Raw
  $bundle = $text | ConvertFrom-Json
  if ($bundle.production_certified -ne $false -or
      $bundle.authenticated_server_receipt_proof -cne 'REQUIRES_INDEPENDENT_READ_ONLY_DB_VERIFICATION' -or
      $bundle.local_sqlite_ack_evidence -cne 'HASHES_MATCH_LOCAL_DELIVERED' -or
      @($bundle.artifacts).Count -ne 3 -or
      $bundle.windows_preflight -cne 'EXTERNAL_ACCEPTANCE_REQUIRED') {
    throw 'Evidence index incorrectly certified production or missed file hashes.'
  }
  if ($text.Contains($fakeSecret)) { throw 'Private input leaked into redacted N32 evidence.' }

  # N33: optional standalone MySQL report must match hashes AND count. It
  # remains unsigned and must never be treated as production signoff.
  $serverFile = Join-Path $temp 'stage33-server.json'
  $serverBundle = Join-Path $temp 'stage33-bundle.json'
  $localHash = (Get-FileHash -LiteralPath $offlinePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $recoveredHash = (Get-FileHash -LiteralPath $recoveredPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    schema='aaditech-stage33-server-receipt-v1'
    run_id=$run
    batch_id=$batchId
    scoped_mysql_receipt_verified=$true
    report_authenticated_to_operator=$false
    production_certified=$false
    raw_http_json_hash_matched=$false
    network_partition_independently_measured=$false
    receipt_count=1
    accepted_count=1
    offline_evidence_sha256=$localHash
    recovered_evidence_sha256=$recoveredHash
    local_payload_sha256=$sha
    scoped_owner_fingerprint_sha256=('e' * 64)
    server_request_hash_fingerprint_sha256=('f' * 64)
  } | ConvertTo-Json | Set-Content -LiteralPath $serverFile -Encoding utf8
  & $bundler -EvidenceDirectory $temp -BundlePath $serverBundle -ServerReceiptReport $serverFile
  $joined = Get-Content -LiteralPath $serverBundle -Raw | ConvertFrom-Json
  if ($joined.authenticated_server_receipt_proof -cne 'SCOPED_MYSQL_REPORT_MATCHED_OPERATOR_SIGNOFF_PENDING' -or
      $joined.server_report_source_authenticated -ne $false -or
      $joined.production_certified -ne $false -or
      @($joined.artifacts).Count -ne 3) {
    throw 'N33 composite bundle incorrectly trusts unsigned server receipt or loses provenance.'
  }
  $serverEvidence = Get-Content -LiteralPath $serverFile -Raw | ConvertFrom-Json
  $serverEvidence.accepted_count = 3
  $serverEvidence | ConvertTo-Json | Set-Content -LiteralPath $serverFile -Encoding utf8
  Assert-Blocked {
    & $bundler -EvidenceDirectory $temp -BundlePath (Join-Path $temp 'bad-n33-bundle.json') -ServerReceiptReport $serverFile
  } 'changed server event count'
  if (Test-Path (Join-Path $temp 'bad-n33-bundle.json')) {
    throw 'N33 count mismatch produced a composite bundle.'
  }
  Assert-Blocked {
    & $bundler -EvidenceDirectory $temp -BundlePath $bundlePath
  } 'bundle overwrite'
  $recovered = Get-Content -LiteralPath $recoveredPath -Raw | ConvertFrom-Json
  $recovered.payload_sha256 = 'd' * 64
  $recovered | ConvertTo-Json | Set-Content -LiteralPath $recoveredPath -Encoding utf8
  Assert-Blocked {
    & $bundler -EvidenceDirectory $temp -BundlePath (Join-Path $temp 'tampered.json')
  } 'tampered replay digest'
  if (Test-Path (Join-Path $temp 'tampered.json')) {
    throw 'Tampered input created a false evidence bundle.'
  }
  Write-Host 'N32 PASS: operator consent, no-network default, redacted SHA256 evidence, fail-closed mismatch and no overwrite.'
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
