# N29 canonical agent replay behavioral test. No real HTTP, SQLite or Windows
# service: parse the production worker and execute selected functions in mock.
$ErrorActionPreference = 'Stop'
$workerPath = Join-Path $PSScriptRoot '..\agent\Agent-Collect.ps1'
$worker = Get-Content -LiteralPath $workerPath -Raw
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($worker, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw 'Canonical worker did not parse cleanly' }
foreach ($name in @('Send-AgentBatch', 'Wait-ForNextAgentCycle')) {
    $fn = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    if (-not $fn) { throw "Missing canonical worker function $name" }
    . ([scriptblock]::Create($fn.Extent.Text))
}
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "N29 assertion failed: $Message" }
}
Assert-True ($worker.Contains('CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_pending')) 'at-most-one in-flight SQLite snapshot'

$script:QueueDb = 'mock-only.db'
$script:FlushBackoff = 0
$script:QueryRows = ''
$script:PendingSnapshot = $null
$script:Persisted = @()
$script:Updates = @()
$script:SnapshotAcks = 0
$script:Sent = @()
$script:Mode = 'valid'
$script:Sleeps = @()
$script:Snapshots = 0
$script:Hearts = 0

function Invoke-SQLite {
    param([string]$Query, [string]$DatabasePath, [switch]$AsJson)
    if ($Query -match '^\s*SELECT batch_id, body_json, event_ids FROM telemetry_outbox') {
        if ($null -eq $script:PendingSnapshot) { return '' }
        return (ConvertTo-Json -InputObject @($script:PendingSnapshot) -Compress -Depth 12)
    }
    if ($Query -match '^\s*SELECT id, kind, payload') { return $script:QueryRows }
    if ($Query -match "^\s*INSERT INTO telemetry_outbox .* VALUES \('(?<id>[^']+)', '(?<body>(?:''|[^'])*)', '(?<ids>(?:''|[^'])*)'\);") {
        if ($null -ne $script:PendingSnapshot) { throw 'Double staged pending request' }
        $script:PendingSnapshot = [pscustomobject]@{
            batch_id = $Matches.id
            body_json = $Matches.body.Replace("''", "'")
            event_ids = $Matches.ids.Replace("''", "'")
        }
        $script:Persisted += $script:PendingSnapshot
        return
    }
    if ($Query -match '^\s*UPDATE outbox') {
        $script:Updates += $Query
        return
    }
    if ($Query -match '^\s*UPDATE telemetry_outbox') {
        if ($null -eq $script:PendingSnapshot) { throw 'No snapshot to acknowledge' }
        $script:SnapshotAcks++
        $script:PendingSnapshot = $null
        return
    }
    throw "Unexpected SQLite mock SQL: $Query"
}
function Get-FreshAgentSnapshot {
    $script:Snapshots++
    return @{
        metrics = @{ cpu = @{ utilization_pct = 0 }; ram = @{ utilization_pct = 52 }; disk = @{ free_gb = 0 } }
        posture = @{ bitlocker_status = 'UNKNOWN'; firewall_status = 'UNKNOWN'; antivirus_status = 'UNKNOWN'; security_score = $null }
    }
}
function Get-AgentHostname { return 'TEST-PC' }
function Get-QueueInstanceId { return '0123456789abcdef0123456789abcdef' }
function Get-AgentIP { return '127.0.0.1' }
function Get-InstalledAgentVersion { return '1.1.2' }
function Get-AgentToken { param($Config); return 'itk_dev_mock_only' }
function Get-RestCertificate { param($Config); return $null }
function Write-AgentLog { param([string]$Message) }
function Get-NextBackoffSleepSeconds { param([int]$FailedConsecutive); return 0 }
function Invoke-QueueSleep { param($SleepSeconds) }
function Invoke-RestMethod {
    [CmdletBinding()]
    param($Uri, $Method, $Headers, $ContentType, $Body, $Certificate, $MaximumRedirection, $TimeoutSec)
    if ($MaximumRedirection -ne 0 -or $TimeoutSec -ne 15) { throw 'Unsafe telemetry transport options' }
    $script:Sent += [string]$Body
    if ($script:Mode -eq 'offline') { throw 'Simulated network partition' }
    $sent = $Body | ConvertFrom-Json
    $reply = @{ status = 'OK'; accepted = @($sent.events).Count; batch_id = $sent.batch_id
        duplicate = $false; recorded_at = '2026-11-17T00:00:00.000Z' }
    switch ($script:Mode) {
        'partial' { $reply.accepted = -1 }
        'wrongBatch' { $reply.batch_id = 'different' }
        'missingBatch' { $reply.Remove('batch_id') }
        'missingCount' { $reply.Remove('accepted') }
        'badStatus' { $reply.status = 'RETRY' }
        'stringCount' { $reply.accepted = [string]$reply.accepted }
        'arrayId' { $reply.batch_id = @($reply.batch_id) }
        'missingDuplicate' { $reply.Remove('duplicate') }
        'stringDuplicate' { $reply.duplicate = 'false' }
        'missingRecorded' { $reply.Remove('recorded_at') }
        'badRecorded' { $reply.recorded_at = 'not-a-date' }
        'duplicate' { $reply.duplicate = $true }
    }
    return [pscustomobject]$reply
}
function Send-AgentHeartbeat { param($Config); $script:Hearts++; return $true }
function Start-Sleep { param([int]$Seconds); $script:Sleeps += $Seconds }
$cfg = [pscustomobject]@{ endpoint = 'https://invalid.example.test/api/v1/ingest/telemetry'; agent_version = '1.1.2' }

# Even an empty outbox creates a new durable snapshot with measured zero.
$result = Send-AgentBatch -Config $cfg
Assert-True ($result -eq 0) 'empty snapshot event count'
Assert-True ($script:Snapshots -eq 1) 'idle snapshot measured exactly once'
Assert-True ($script:Persisted.Count -eq 1) 'snapshot persisted before POST'
Assert-True ($script:SnapshotAcks -eq 1) 'snapshot ACK persisted'
Assert-True ($null -eq $script:PendingSnapshot) 'successful snapshot retired'
$first = $script:Sent[-1] | ConvertFrom-Json
Assert-True ($first.batch_id -match '^[0-9a-f]{32}$') 'unique batch ID'
Assert-True ($first.events.Count -eq 0) 'empty events list'
Assert-True ($first.metrics.disk.free_gb -eq 0) 'genuine measured zero preserved'
Assert-True ($first.posture.bitlocker_status -eq 'UNKNOWN') 'unknown posture preserved'

# Lost ACK: SQLite must retain exact payload and IDs, and retry it BYTE-FOR-BYTE.
$script:QueryRows = '[{"id":17,"kind":"health","payload":"{}","sanitized":1,"created_at":"2026-11-17 00:00:00"}]'
$script:Mode = 'offline'
$priorSamples = $script:Snapshots
$result = Send-AgentBatch -Config $cfg
Assert-True ($result -eq 0) 'lost response is failure'
Assert-True ($null -ne $script:PendingSnapshot) 'lost ACK never drops staged snapshot'
$lostBody = $script:Sent[-1]
Assert-True ($script:Snapshots -eq ($priorSamples + 1)) 'measured once before offline POST'
$script:Mode = 'valid'
$result = Send-AgentBatch -Config $cfg
Assert-True ($result -eq 1) 'same response ACK accepts one event'
Assert-True ($script:Sent[-1] -ceq $lostBody) 'network retry sends identical HTTP bytes'
Assert-True ($script:Snapshots -eq ($priorSamples + 1)) 'retry MUST NOT recollect snapshot'
Assert-True ($script:Updates[-1] -match 'WHERE status=''pending'' AND id IN \(17\)') 'only local row 17 delivered'
$storedEvent = $script:Sent[-1] | ConvertFrom-Json
Assert-True ($storedEvent.events[0].client_msg_id -eq '0123456789abcdef0123456789abcdef:17') 'N28 stable event ID preserved'
Assert-True ($null -eq $script:PendingSnapshot) 'matching ACK retires snapshot'

# Bad HTTP 2xx and partial ACKs must keep one durable pending snapshot; the
# saved payload must survive every error until an exact matching response.
$script:QueryRows = ''
$script:Mode = 'missingBatch'
$result = Send-AgentBatch -Config $cfg
Assert-True ($result -eq 0) 'missing batch ID is failure'
$pendingBody = $script:PendingSnapshot.body_json
$priorSamples = $script:Snapshots
foreach ($mode in @('partial', 'wrongBatch', 'missingCount', 'badStatus', 'stringCount', 'arrayId',
    'missingDuplicate', 'stringDuplicate', 'missingRecorded', 'badRecorded', 'offline')) {
    $script:Mode = $mode
    $result = Send-AgentBatch -Config $cfg
    Assert-True ($result -eq 0) "bad ACK $mode is failure"
    Assert-True ($script:PendingSnapshot.body_json -ceq $pendingBody) 'pending request is immutable'
    Assert-True ($script:Sent[-1] -ceq $pendingBody) 'every retry resends exact bytes'
    Assert-True ($script:Snapshots -eq $priorSamples) 'no remeasurement on retry'
}
$script:Mode = 'duplicate'
$null = Send-AgentBatch -Config $cfg
Assert-True ($null -eq $script:PendingSnapshot) 'eventual complete duplicate ACK retires batch'
$script:Mode = 'valid'

# Every 5 min of a long inventory interval, create a newly sampled snapshot.
$script:QueryRows = ''
$script:Hearts = 0
$script:Sleeps = @()
$before = $script:Sent.Count
Wait-ForNextAgentCycle -Config $cfg -Seconds 970
Assert-True (($script:Sleeps -join ',') -eq '300,300,300,70') 'five-minute telemetry cadence'
Assert-True ($script:Hearts -eq 3) 'inter-cycle heartbeat'
Assert-True (($script:Sent.Count - $before) -eq 3) 'three new snapshot uploads'
$before = $script:Sent.Count
$script:Hearts = 0
Wait-ForNextAgentCycle -Config $cfg -Seconds 600 -SkipTelemetry $true
Assert-True ($script:Hearts -eq 1) 'collect-only heartbeat'
Assert-True ($script:Sent.Count -eq $before) 'collect-only no telemetry'
Write-Host 'N29 PASS: durable SQLite payload, byte-identical retry, fail-closed ACK and cadence'
