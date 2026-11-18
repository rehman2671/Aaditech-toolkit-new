#Requires -Version 5.1
<#
N32 physical customer Windows replay evidence collector. READ-ONLY for SQLite,
agent task, credentials, configuration and network.
Run as an operator in an authorized maintenance window. Does not disconnect a
network, start an agent, send HTTP, or claim server receipt confirmation.
Offline:    -Phase Offline -OperatorConfirmedOffline
Recovered:  -Phase Recovered -OperatorConfirmedReconnect
Both phases use the same NEW evidence directory and installed sqlite3.exe.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Offline','Recovered')][string]$Phase,
    [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
    [string]$QueueDb = (Join-Path $env:ProgramData 'ITToolkit-Agent\queue.sqlite3'),
    [string]$SqliteExe = (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'IT-Toolkit\sqlite3.exe'),
    [switch]$OperatorConfirmedOffline,
    [switch]$OperatorConfirmedReconnect
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'N32 physical acceptance requires Windows.' }
if ($Phase -eq 'Offline' -and (-not $OperatorConfirmedOffline -or $OperatorConfirmedReconnect)) {
    throw 'Offline phase requires only -OperatorConfirmedOffline after an authorized outage.'
}
if ($Phase -eq 'Recovered' -and (-not $OperatorConfirmedReconnect -or $OperatorConfirmedOffline)) {
    throw 'Recovered phase requires only -OperatorConfirmedReconnect after network restoration.'
}
if (-not (Test-Path -LiteralPath $EvidenceDirectory -PathType Container) -or
    (Get-Item -LiteralPath $EvidenceDirectory).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
    throw 'Use an existing non-symlink evidence directory with restricted access.'
}
if (-not (Test-Path -LiteralPath $QueueDb -PathType Leaf) -or
    -not (Test-Path -LiteralPath $SqliteExe -PathType Leaf)) {
    throw 'Installed durable SQLite database or sqlite3.exe is missing.'
}
$offlinePath = Join-Path $EvidenceDirectory 'stage32-offline.json'
$recoveredPath = Join-Path $EvidenceDirectory 'stage32-recovered.json'
$targetPath = if ($Phase -eq 'Offline') { $offlinePath } else { $recoveredPath }
if (Test-Path -LiteralPath $targetPath) { throw 'Refusing to overwrite immutable evidence.' }
function Get-Hash([string]$Value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
        finally { $sha.Dispose() }
    } finally { [Array]::Clear($bytes,0,$bytes.Length) }
}
function Read-SqliteJson([string]$Sql) {
    $lines = @(& $SqliteExe -readonly -batch $QueueDb $Sql 2>$null)
    if ($LASTEXITCODE -ne 0 -or $lines.Count -ne 1 -or
        [string]::IsNullOrWhiteSpace([string]$lines[0])) {
        throw 'Cannot read consistent SQLite evidence.'
    }
    try { return ([string]$lines[0] | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw 'Invalid local SQLite acceptance record.' }
}
function Assert-QueueIdentity($State) {
    if ($State.integrity -cne 'ok' -or $State.queue_identity -notmatch '^[0-9a-fA-F]{32}$') {
        throw 'SQLite integrity or permanent queue identity is invalid.'
    }
}
function Get-EventIds([string]$EventIdsJson) {
    $ids = @()
    try {
        $decoded = ConvertFrom-Json -InputObject $EventIdsJson -ErrorAction Stop
        foreach ($x in @($decoded)) {
            $value = [long]0
            if (-not [long]::TryParse([string]$x, [ref]$value) -or $value -lt 1) {
                throw 'Invalid event ID'
            }
            $ids += $value
        }
    } catch { throw 'Saved queue event IDs are invalid.' }
    if (@($ids | Select-Object -Unique).Count -ne $ids.Count -or $ids.Count -gt 50) {
        throw 'Saved queue event IDs are duplicated or too many.'
    }
    return ,$ids
}
function Test-EventsWithStatus([long[]]$Ids,[string]$State) {
    if ($Ids.Count -eq 0) { return $true }
    $list = ($Ids | ForEach-Object { [string]$_ }) -join ','
    $sql = "SELECT json_object('matching',COUNT(*)) FROM outbox WHERE id IN ($list) AND status='$State';"
    $r = Read-SqliteJson $sql
    return ([int]$r.matching -eq $Ids.Count)
}
function Write-Evidence([string]$Path,$Value) {
    $json = $Value | ConvertTo-Json -Depth 8
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json + [Environment]::NewLine)
    try {
        $file = [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $file.Write($bytes,0,$bytes.Length); $file.Flush() }
        finally { $file.Dispose() }
    } finally { [Array]::Clear($bytes,0,$bytes.Length) }
}
if ($Phase -eq 'Offline') {
    if (Test-Path -LiteralPath $recoveredPath) { throw 'Recovered evidence already exists.' }
    $state = Read-SqliteJson @'
SELECT json_object(
 'integrity',(SELECT integrity_check FROM pragma_integrity_check LIMIT 1),
 'queue_identity',(SELECT instance_id FROM queue_identity WHERE singleton_id=1),
 'pending_count',(SELECT COUNT(*) FROM telemetry_outbox WHERE status='pending'),
 'pending',(SELECT json_object('batch_id',batch_id,'body_json',body_json,'event_ids',event_ids)
            FROM telemetry_outbox WHERE status='pending' LIMIT 1)
);
'@
    Assert-QueueIdentity $state
    if ([int]$state.pending_count -ne 1 -or $null -eq $state.pending) {
        throw 'No unique in-flight telemetry batch: first execute agent during approved outage.'
    }
    $pending = $state.pending
    if ($pending -is [string]) { $pending = $pending | ConvertFrom-Json }
    $batchId = [string]$pending.batch_id
    if ($batchId -notmatch '^[0-9a-fA-F]{32}$') { throw 'Unexpected in-flight batch ID.' }
    $body = [string]$pending.body_json
    try { $parsed = $body | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'Saved HTTP payload is not valid JSON.' }
    if ([string]$parsed.batch_id -cne $batchId) { throw 'Saved payload batch ID mismatch.' }
    $ids = @(Get-EventIds ([string]$pending.event_ids))
    if (@($parsed.events).Count -ne $ids.Count -or
        -not (Test-EventsWithStatus -Ids $ids -State 'pending')) {
        throw 'In-flight batch does not match pending local outbox rows.'
    }
    $report = [ordered]@{
        schema='aaditech-stage32-offline-v1'
        run_id=[guid]::NewGuid().ToString('N')
        captured_utc=[DateTime]::UtcNow.ToString('o')
        phase='OFFLINE_OPERATOR_ATTESTED'
        queue_identity_sha256=(Get-Hash ([string]$state.queue_identity))
        batch_id=$batchId
        payload_sha256=(Get-Hash $body)
        event_ids_sha256=(Get-Hash ([string]$pending.event_ids))
        in_flight_events=$ids.Count
        sqlite_integrity='ok'
        network_interruption_independently_measured=$false
        server_receipt_independently_verified=$false
        certified_for_production=$false
    }
    Write-Evidence -Path $offlinePath -Value $report
    Write-Host 'N32 OFFLINE evidence saved: pending batch, matching local rows, integrity and SHA256 only.'
    Write-Host 'Do NOT treat operator outage attestation as independent network or server proof.'
} else {
    if (-not (Test-Path -LiteralPath $offlinePath -PathType Leaf) -or
        (Get-Item -LiteralPath $offlinePath).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
        throw 'Immutable offline evidence is required before recovered observation.'
    }
    try { $prior = Get-Content -LiteralPath $offlinePath -Raw | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'Offline evidence is invalid.' }
    if ($prior.schema -cne 'aaditech-stage32-offline-v1' -or
        [string]$prior.batch_id -notmatch '^[0-9a-fA-F]{32}$' -or
        [string]$prior.payload_sha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$prior.queue_identity_sha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$prior.event_ids_sha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'Offline evidence was not produced by the expected schema.'
    }
    $batchId = [string]$prior.batch_id
    # Batch ID is exclusively validated 32-hex before SQL interpolation.
    $sql = @"
SELECT json_object(
 'integrity',(SELECT integrity_check FROM pragma_integrity_check LIMIT 1),
 'queue_identity',(SELECT instance_id FROM queue_identity WHERE singleton_id=1),
 'pending_count',(SELECT COUNT(*) FROM telemetry_outbox WHERE status='pending' AND batch_id='$batchId'),
 'delivered',(SELECT json_object('batch_id',batch_id,'body_json',body_json,'event_ids',event_ids)
              FROM telemetry_outbox WHERE status='delivered' AND batch_id='$batchId' LIMIT 1)
);
"@
    $state = Read-SqliteJson $sql
    Assert-QueueIdentity $state
    if ((Get-Hash ([string]$state.queue_identity)) -cne [string]$prior.queue_identity_sha256) {
        throw 'Queue lifetime identity changed across reconnect.'
    }
    if ([int]$state.pending_count -ne 0 -or $null -eq $state.delivered) {
        throw 'Original batch is still unacknowledged; local delivery was not observed.'
    }
    $delivered = $state.delivered
    if ($delivered -is [string]) { $delivered = $delivered | ConvertFrom-Json }
    if ((Get-Hash ([string]$delivered.body_json)) -cne [string]$prior.payload_sha256 -or
        (Get-Hash ([string]$delivered.event_ids)) -cne [string]$prior.event_ids_sha256) {
        throw 'Previously in-flight immutable body or event identifiers were changed.'
    }
    $ids = @(Get-EventIds ([string]$delivered.event_ids))
    if ($ids.Count -ne [int]$prior.in_flight_events -or
        -not (Test-EventsWithStatus -Ids $ids -State 'delivered')) {
        throw 'Some event rows were not acknowledged locally.'
    }
    $report = [ordered]@{
        schema='aaditech-stage32-recovered-v1'
        run_id=[string]$prior.run_id
        captured_utc=[DateTime]::UtcNow.ToString('o')
        phase='LOCAL_SQLITE_ACK_OBSERVED'
        batch_id=$batchId
        payload_sha256=[string]$prior.payload_sha256
        queue_identity_sha256=[string]$prior.queue_identity_sha256
        local_ack_observed=$true
        delivered_event_count=$ids.Count
        offline_evidence_sha256=(Get-FileHash -LiteralPath $offlinePath -Algorithm SHA256).Hash.ToLowerInvariant()
        network_interruption_independently_measured=$false
        server_receipt_independently_verified=$false
        certified_for_production=$false
    }
    Write-Evidence -Path $recoveredPath -Value $report
    Write-Host 'N32 RECOVERED evidence saved: exact batch body and queued events have local ACK state.'
    Write-Host 'Independent read-only MySQL batch receipt and actual network disruption proof still required.'
}
