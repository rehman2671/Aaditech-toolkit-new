# Isolate actual worker functions. No live endpoint/command/network is used.
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '..\agent\Agent-Collect.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
if($errors.Count) { throw ($errors | Out-String) }
foreach($name in @('ConvertTo-CommandUuid','Get-CommandResultOrigin','Get-CommandDeliveryContext','Assert-CommandBinding','Try-ClaimVerifiedCommand','ConvertTo-CommandResult','Record-ExecutedCommand','Send-CommandResult','Send-PendingCommandResults','Invoke-VerifiedCommandOnce')) {
    $nodes=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true))
    if($nodes.Count -ne 1) { throw "Missing function $name" }
    . ([scriptblock]::Create($nodes[0].Extent.Text))
}
$uuid='6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e'
$dir=Join-Path ([IO.Path]::GetTempPath()) ("itk-ack-test-"+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
$ConfigPath=Join-Path $dir 'agent.json'
$QueueDb='fixture-only'
$script:Cfg=[pscustomobject]@{endpoint='https://example.test/api/v1/ingest/telemetry'}
$script:Row=$null; $script:Executed=0; $script:Queries=0; $script:Posts=0; $script:ReplyMode='lost'
$script:SentBodies=@()
$token='itk_dev_'+('1'*48)
function Read-AgentConfig { $script:Cfg }
function Get-AgentTokenPath { Join-Path $dir 'agent.token' }
function Get-AgentHostname { 'CI-HOST' }
function Write-AgentLog { param($Message) }
function Resolve-VerifiedAgentCommand { param($Config,$Cmd) if($Cmd.valid) { return $Cmd } }
function Invoke-RemoteCommand { param($Config,$Cmd) $script:Executed++; return @{status='completed';output="O'Brien";exit_code=0} }
function ConvertTo-SanitizedText { param($Text) return $Text }
function Get-RestCertificate { param($Config) $null }
function Invoke-SQLite {
    param($Query,$DatabasePath,[switch]$AsJson)
    $script:Queries++
    if($Query.StartsWith('SELECT command_id,binding,status,body')) {
        if($script:Row -and $script:Row.delivery -eq 'pending' -and $Query.Contains("'$($script:Row.binding)'")) {
            return (ConvertTo-Json -InputObject @($script:Row) -Compress)
        }
        return ''
    }
    if(-not $Query.Contains("'$uuid'")) { throw 'Wrong or unquoted UUID' }
    if($Query.StartsWith('INSERT OR IGNORE')) {
        if($script:Row) { return '0' }
        if($Query -notmatch "SELECT '$uuid','([a-f0-9]{64})','claimed'") { throw 'Missing claim binding' }
        $script:Row=@{command_id=$uuid;binding=$Matches[1];status='claimed';delivery='none';body=''}
        return '1'
    }
    if(-not $Query.Contains("'$($script:Row.binding)'")) { throw 'Wrong delivery binding' }
    if($Query.StartsWith('UPDATE command_results_v3 SET status=')) {
        if($script:Row.status -ne 'claimed') { return '0' }
        if($Query -notmatch "CAST\(X'([a-f0-9]+)' AS TEXT\)") { throw 'Result body is not hex encoded' }
        $script:Row.body=[Text.Encoding]::UTF8.GetString([Convert]::FromHexString($Matches[1]))
        $script:Row.status=($script:Row.body | ConvertFrom-Json).status
        $script:Row.delivery='pending'
        return '1'
    }
    if($Query.StartsWith('UPDATE command_results_v3 SET last_attempt=')) { return '1' }
    if($Query.StartsWith("UPDATE command_results_v3 SET delivery='acknowledged'")) {
        $script:Row.delivery='acknowledged'; return '1'
    }
    throw 'Unexpected SQL'
}
function Invoke-RestMethod {
    param($Uri,$Method,$Headers,$ContentType,$Body,$Certificate,$MaximumRedirection,$TimeoutSec,$ErrorAction)
    if($Uri -ne "https://example.test/api/commands/$uuid/result" -or $MaximumRedirection -ne 0 -or $Headers['X-Device-Token'] -cne $token) { throw 'Wrong delivery target, credential or redirect policy' }
    $script:Posts++
    $script:SentBodies += [Text.Encoding]::UTF8.GetString($Body)
    if($script:ReplyMode -eq 'lost') { throw 'Synthetic lost HTTP response after server commit' }
    if($script:ReplyMode -eq 'malformed') { return @{ok=$true;id='another-id';status='completed';duplicate=$true;completed_at='2026-11-24T00:00:00Z'} }
    return @{ok=$true;id=$uuid;status='completed';duplicate=$true;completed_at='2026-11-24T00:00:00Z'}
}
try {
    [IO.File]::WriteAllText((Get-AgentTokenPath),$token)
    $identity=@{device_id='device-1';tenant_id='tenant-A';device_uid='uid-1'}
    $identityPath=Join-Path $dir 'agent.identity.json'
    $identity | ConvertTo-Json -Compress | Set-Content -LiteralPath $identityPath
    $context=Get-CommandDeliveryContext $script:Cfg
    Invoke-VerifiedCommandOnce -Config $script:Cfg -Cmd @{id='untrusted';valid=$false}
    if($script:Queries -or $script:Executed -or $script:Posts) { throw 'Unverified command touched DB/execution/HTTP' }
    Invoke-VerifiedCommandOnce -Config $script:Cfg -Cmd @{id=$uuid;valid=$true}
    Invoke-VerifiedCommandOnce -Config $script:Cfg -Cmd @{id=$uuid;valid=$true}
    if($script:Executed -ne 1 -or $script:Row.delivery -ne 'pending' -or $script:Posts) { throw 'Command did not persist once before delivery' }
    Send-PendingCommandResults -Config $script:Cfg
    if($script:Posts -ne 1 -or $script:Row.delivery -ne 'pending') { throw 'Lost ACK incorrectly acknowledged' }
    $identity.tenant_id='tenant-B'
    $identity | ConvertTo-Json -Compress | Set-Content -LiteralPath $identityPath
    Send-PendingCommandResults -Config $script:Cfg
    $identity.tenant_id='tenant-A'
    $identity | ConvertTo-Json -Compress | Set-Content -LiteralPath $identityPath
    [IO.File]::WriteAllText((Get-AgentTokenPath),('itk_dev_'+('2'*48)))
    Send-PendingCommandResults -Config $script:Cfg
    [IO.File]::WriteAllText((Get-AgentTokenPath),$token)
    $old=$script:Cfg
    $script:Cfg=[pscustomobject]@{endpoint='https://other.test/api/ingest'}
    Send-PendingCommandResults -Config $old
    Send-PendingCommandResults -Config $script:Cfg
    $script:Cfg=$old
    if($script:Posts -ne 1) { throw 'Cross-identity, rotated credential or changed origin leaked old result' }
    $script:ReplyMode='malformed'
    Send-PendingCommandResults -Config $script:Cfg
    if($script:Posts -ne 2 -or $script:Row.delivery -ne 'pending') { throw 'Malformed receipt acknowledged' }
    $script:ReplyMode='valid'
    Send-PendingCommandResults -Config $script:Cfg
    Send-PendingCommandResults -Config $script:Cfg
    if($script:Posts -ne 3 -or $script:Executed -ne 1 -or $script:Row.delivery -ne 'acknowledged') { throw 'Exact retry not acknowledged or command reran' }
    if(@($script:SentBodies | Select-Object -Unique).Count -ne 1) { throw 'Retry body changed' }
    $body=$script:SentBodies[0] | ConvertFrom-Json
    if($body.status -ne 'completed' -or $body.output -ne "O'Brien" -or $body.exit_code -ne 0 -or @($body.PSObject.Properties.Name).Count -ne 3) { throw 'Wrong strict result body' }
    $script:Row.status='claimed'; $script:Row.delivery='none'; $script:Row.body=''
    Invoke-VerifiedCommandOnce -Config $script:Cfg -Cmd @{id=$uuid;valid=$true}
    Send-PendingCommandResults -Config $script:Cfg
    if($script:Executed -ne 1 -or $script:Posts -ne 3) { throw 'Uncertain claim reran or falsely reported' }
    Write-Host '[PASS] UUID claim, immutable lost-ACK retry, origin/identity/credential binding and receipt validation.'
} finally { Remove-Item -LiteralPath $dir -Recurse -Force }
