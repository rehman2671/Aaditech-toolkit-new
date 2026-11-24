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
$token = 'itk_dev_' + ('1' * 48)
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
    foreach ($entry in @(
        @{ field='version'; value='1' }, @{ field='version'; value=$true },
        @{ field='device_id'; value=@('device-42') }, @{ field='tenant_id'; value=@('tenant-A') },
        @{ field='hostname'; value=@('CI-HOST') }, @{ field='kind'; value=' ' },
        @{ field='payload'; value=@('not-an-object') }, @{ field='issued_at'; value=1 },
        @{ field='expires_at'; value=$null }
    )) {
        $malformed = [ordered]@{}; foreach ($key in $data.Keys) { $malformed[$key] = $data[$key] }
        $malformed[$entry.field] = $entry.value
        Assert-Blocked (Sign-TestCommand $malformed $token) "MAC-valid malformed $($entry.field)"
    }
    $nonString = $cmd.PSObject.Copy(); $nonString.signature = @($cmd.signature)
    Assert-Blocked $nonString 'array signature'
    $nonString = $cmd.PSObject.Copy(); $nonString.id = @($cmd.id)
    Assert-Blocked $nonString 'array outer ID'
    $shortToken = 'itk_dev_' + ('1' * 47)
    [IO.File]::WriteAllText((Get-AgentTokenPath), $shortToken)
    Assert-Blocked (Sign-TestCommand $data $shortToken) 'noncanonical credential'
    [IO.File]::WriteAllText((Get-AgentTokenPath), $token)
    Remove-Item (Join-Path $dir 'agent.identity.json') -Force
    Assert-Blocked $cmd 'missing trusted identity'
    # Evaluate the real dispatcher in isolation; only harmless CI fixture
    # scripts exist under the temporary root. Never start the agent.
    $dispatch = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Invoke-RemoteCommand'
    }, $true))
    if ($dispatch.Count -ne 1) { throw 'Expected one dispatcher' }
    Invoke-Expression $dispatch[0].Extent.Text
    $script:RepoRoot = Join-Path $dir 'root'
    $outside = Join-Path $dir 'outside'
    New-Item -ItemType Directory -Path $script:RepoRoot,$outside | Out-Null
    Set-Content -LiteralPath (Join-Path $script:RepoRoot 'safe.ps1') -Value "Write-Output 'safe fixture'"
    Set-Content -LiteralPath (Join-Path $outside 'fixture.ps1') -Value "Write-Output 'outside fixture'"
    $allowed = @{run_script_allowlist=@('safe.ps1','link/fixture.ps1','../outside/fixture.ps1')}
    $ok = Invoke-RemoteCommand $allowed @{kind='run-script';payload=@{script='safe.ps1'}}
    if ($ok.status -ne 'completed' -or $ok.output -notmatch 'safe fixture') { throw 'Safe fixture was not executed' }
    foreach ($invalid in @(@{script=@('safe.ps1')},@{script='../outside/fixture.ps1'})) {
        if ((Invoke-RemoteCommand $allowed @{kind='run-script';payload=$invalid}).status -ne 'failed') {
            throw 'Invalid script path was accepted'
        }
    }
    $junction = Join-Path $script:RepoRoot 'link'
    try {
        New-Item -ItemType Junction -Path $junction -Target $outside -ErrorAction Stop | Out-Null
        $denied = Invoke-RemoteCommand $allowed @{kind='run-script';payload=@{script='link/fixture.ps1'}}
        if ($denied.status -ne 'failed' -or $denied.output -notmatch 'reparse point') {
            throw 'Allowlisted junction escape was not rejected'
        }
    } finally {
        if (Test-Path -LiteralPath $junction) { [IO.Directory]::Delete($junction) }
    }
    Write-Host 'Per-device command verification and script containment regression tests passed.'
} finally {
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
