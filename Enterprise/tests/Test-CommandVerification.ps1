# Regression tests for the actual installed worker's HMAC/recipient verifier.
# Evaluate ONLY the isolated FunctionDefinitionAst; never start the agent loop.
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\agent\Agent-Collect.ps1'
$parseTokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw "Agent script parser errors: $($parseErrors | Out-String)" }
$matches = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Resolve-VerifiedAgentCommand'
}, $true))
if ($matches.Count -ne 1) { throw 'Expected exactly one command signature verifier in the installed worker' }
Invoke-Expression $matches[0].Extent.Text

$dir = Join-Path ([IO.Path]::GetTempPath()) ("itk-cmd-hmac-" + [guid]::NewGuid().ToString('N'))
New-Item -Path $dir -ItemType Directory -Force | Out-Null
$script:ConfigPath = Join-Path $dir 'agent.json'
function Get-AgentTokenPath { Join-Path $dir 'agent.token' }
function Get-AgentHostname { 'CI-HOST' }
function Write-AgentLog { param([string]$Message) }
$token = 'itk_dev_11111111111111111111111111111111111111111111111'
$identity = @{ device_id = 'device-42'; tenant_id = 'tenant-A'; device_uid = 'ci-uid' }
function Sign-TestCommand($data, $tok) {
    $content = $data | ConvertTo-Json -Compress -Depth 10
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    try {
        $hmac.Key = [Text.Encoding]::UTF8.GetBytes($tok)
        $digest = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("aaditech:agent-command:v1`n" + $content))
        $signature = ([BitConverter]::ToString($digest)).Replace('-', '').ToLowerInvariant()
    } finally { $hmac.Dispose() }
    return [PSCustomObject]@{ id = $data.command_id; signed_content = $content; signature = $signature; kind = 'reboot'; payload = @{ delay_seconds = 0 } }
}
function Assert-Blocked($command, $reason) {
    if ($null -ne (Resolve-VerifiedAgentCommand -Config @{} -Cmd $command)) {
        throw "Accepted untrusted command: $reason"
    }
}
try {
    [IO.File]::WriteAllText((Join-Path $dir 'agent.token'), $token)
    $identity | ConvertTo-Json -Compress | Set-Content (Join-Path $dir 'agent.identity.json')
    $now = [DateTimeOffset]::UtcNow
    $data = [ordered]@{
        version = 1
        command_id = 'cmd-99'
        device_id = 'device-42'
        tenant_id = 'tenant-A'
        hostname = 'CI-HOST'
        kind = 'run-script'
        payload = @{ script = 'Scripts/QuickCheck.ps1' }
        issued_at = $now.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        expires_at = $now.AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    }
    $cmd = Sign-TestCommand $data $token
    $verified = Resolve-VerifiedAgentCommand -Config @{} -Cmd $cmd
    if (-not $verified -or $verified.kind -ne 'run-script' -or
        $verified.payload.script -ne 'Scripts/QuickCheck.ps1') {
        throw 'A valid device-bound command did not verify the signed executable fields.'
    }
    $tampered = $cmd.PSObject.Copy()
    $tampered.signed_content = $tampered.signed_content.Replace('run-script', 'reboot')
    Assert-Blocked $tampered 'tampered executable kind'
    $badId = $cmd.PSObject.Copy()
    $badId.id = 'another-command'
    Assert-Blocked $badId 'wrong command ID'
    $badSignature = $cmd.PSObject.Copy()
    $badSignature.signature = ('0' * 64)
    Assert-Blocked $badSignature 'wrong MAC'
    $badTenantData = [ordered]@{}; foreach($k in $data.Keys){ $badTenantData[$k]=$data[$k] }
    $badTenantData.tenant_id = 'tenant-B'
    Assert-Blocked (Sign-TestCommand $badTenantData $token) 'wrong tenant'
    $expiredData = [ordered]@{}; foreach($k in $data.Keys){ $expiredData[$k]=$data[$k] }
    $expiredData.issued_at = $now.AddMinutes(-10).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $expiredData.expires_at = $now.AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    Assert-Blocked (Sign-TestCommand $expiredData $token) 'expired command'
    Remove-Item (Join-Path $dir 'agent.identity.json') -Force
    Assert-Blocked $cmd 'missing trusted identity'
    Write-Host 'Per-device command verification regression tests passed.'
} finally {
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
