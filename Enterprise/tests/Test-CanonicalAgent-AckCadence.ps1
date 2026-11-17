# N27 behavioral safety test: extract ONLY the target functions, not the
# worker's real startup/enrollment/network code. Never contact an endpoint.
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
    if (-not $Condition) { throw "N27 assertion failed: $Message" }
}

# Local deterministic substitutes. No real network, SQLite or sleep.
$script:QueueDb = 'memory-only.db'
$script:FlushBackoff = 0
$script:QueryRows = ''
$script:Updates = @()
$script:Sent = @()
$script:Ack = [pscustomobject]@{ status = 'OK'; accepted = 0 }
$script:ThrowNetwork = $false
$script:Hearts = 0
$script:Sleeps = @()
$script:Snapshots = 0
function Invoke-SQLite {
    param([string]$Query, [string]$DatabasePath, [switch]$AsJson)
    if ($Query -match '^\s*SELECT ') { return $script:QueryRows }
    if ($Query -match '^\s*UPDATE outbox') {
        $script:Updates += $Query
        return
    }
    throw "Unexpected mock SQLite query: $Query"
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
    param($Uri,$Method,$Headers,$ContentType,$Body,$Certificate)
    if ($script:ThrowNetwork) { throw 'simulated offline endpoint' }
    $script:Sent += ($Body | ConvertFrom-Json)
    return $script:Ack
}
function Send-AgentHeartbeat { param($Config); $script:Hearts++; return $true }
function Start-Sleep { param([int]$Seconds); $script:Sleeps += $Seconds }
$cfg = [pscustomobject]@{ endpoint = 'https://invalid.example.test/api/v1/ingest/telemetry'; agent_version = '1.1.2' }

# No outbox rows must still upload real measured zero and UNKNOWN posture.
$ackResult = Send-AgentBatch -Config $cfg
Assert-True ($ackResult -eq 0) 'empty queue ACK count'
Assert-True ($script:Sent.Count -eq 1) 'empty queue still sends authenticated telemetry'
Assert-True ($script:Sent[0].events.Count -eq 0) 'empty queue produces events=[]'
Assert-True ($script:Sent[0].metrics.disk.free_gb -eq 0) 'genuine measured 0 GB preserved'
Assert-True ($script:Sent[0].posture.bitlocker_status -eq 'UNKNOWN') 'unknown posture preserved'
Assert-True ($script:Updates.Count -eq 0) 'empty outbox requires no destructive UPDATE'

# An explicit, complete matching ACK delivers only the local integer row ID.
$script:QueryRows = '[{"id":17,"kind":"health","payload":"{}","sanitized":1,"created_at":"2026-11-17 00:00:00"}]'
$script:Ack = [pscustomobject]@{status='OK';accepted=1}
$ackResult = Send-AgentBatch -Config $cfg
Assert-True ($ackResult -eq 1) 'one acknowledged event'
Assert-True ($script:Updates.Count -eq 1) 'one queued event marked delivered'
Assert-True ($script:Updates[0] -match 'WHERE status=''pending'' AND id IN \(17\)') 'only local pending ID 17 can be delivered'
Assert-True ($script:Sent[-1].events.Count -eq 1) 'one serialized outbox event'
Assert-True ($script:Sent[-1].events[0].client_msg_id -eq '0123456789abcdef0123456789abcdef:17') 'stable event ID for retry'

# Valid HTTP status is not a license to silently drop queued events.
foreach ($bad in @(
    [pscustomobject]@{status='OK';accepted=0},
    [pscustomobject]@{status='OK';accepted=2},
    [pscustomobject]@{status='OK'},
    [pscustomobject]@{status='RETRY';accepted=1},
    $null
)) {
    $prior = $script:Updates.Count
    $script:Ack = $bad
    $ackResult = Send-AgentBatch -Config $cfg
    Assert-True ($ackResult -eq 0) 'mismatched HTTP ACK returns failure'
    Assert-True ($script:Updates.Count -eq $prior) 'mismatched HTTP ACK must preserve pending queue'
}
$script:ThrowNetwork = $true
$before = $script:Updates.Count
$null = Send-AgentBatch -Config $cfg
Assert-True ($script:Updates.Count -eq $before) 'network failure cannot acknowledge any events'
$script:ThrowNetwork = $false

# Every 5 min within a long 30-minute inventory interval, refresh heartbeat
# and telemetry without launching any heavy feature collectors.
$script:QueryRows = ''
$script:Ack = [pscustomobject]@{status='OK';accepted=0}
$script:Sleeps = @()
$script:Hearts = 0
$before = $script:Sent.Count
Wait-ForNextAgentCycle -Config $cfg -Seconds 970
Assert-True (($script:Sleeps -join ',') -eq '300,300,300,70') 'bounded five-minute sleep cadence'
Assert-True ($script:Hearts -eq 3) 'three inter-cycle heartbeats'
Assert-True (($script:Sent.Count - $before) -eq 3) 'three independent snapshot-only telemetry uploads'

$before = $script:Sent.Count
$script:Hearts = 0
Wait-ForNextAgentCycle -Config $cfg -Seconds 600 -SkipTelemetry $true
Assert-True ($script:Hearts -eq 1) 'CollectOnly may retain lightweight heartbeat'
Assert-True ($script:Sent.Count -eq $before) 'CollectOnly must never send telemetry'
Write-Host 'N27 PASS: empty outbox telemetry, ACK fail-closed, offline retry and five-minute cadence'
