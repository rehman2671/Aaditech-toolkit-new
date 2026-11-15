# Requires PowerShell 5.1+. Exercises the generic MSI's post-install wizard.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$wizard = Join-Path $root 'agent\Configure-Agent.ps1'
$wxs = Join-Path $root 'agent\wix\Agent.wxs'
$builder = Join-Path $root 'agent\wix\build-msi.ps1'

$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($wizard, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) {
    throw "Wizard has parser errors: $($parseErrors | ForEach-Object Message | Out-String)"
}
[xml]$manifest = Get-Content -LiteralPath $wxs -Raw
if (-not $manifest.SelectSingleNode('//*[local-name()="Component" and @Id="AgentSetupWizard"]')) {
    throw 'WiX installer does not contain Configure-Agent.ps1 component'
}
if (-not (Get-Content $builder -Raw).Contains("Configure-Agent.ps1")) {
    throw 'MSI build is not staging Configure-Agent.ps1'
}
if (-not (Get-Content (Join-Path $root 'agent\endpoint.json') -Raw | ConvertFrom-Json).needs_setup) {
    throw 'Checked-in endpoint.json must remain unprovisioned'
}

$tmpDir = Join-Path ([IO.Path]::GetTempPath()) ("itk-setup-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
try {
    $cfgPath = Join-Path $tmpDir 'agent.json'
    $tokenFile = Join-Path $tmpDir 'bootstrap.txt'
    $singleUse = 'test-single-use-bootstrap-123456789012345'
    [IO.File]::WriteAllText($tokenFile, $singleUse)
    $previous = @{
        endpoint = 'https://old.example.test/api/v1/ingest/telemetry'
        token = 'previous-bootstrap-token-1234'
        needs_setup = $true
        features = @(@{name='health'; script='health.ps1'; enabled=$true; requires_elevation=$false})
        run_script_allowlist = @('safe-script.ps1')
    }
    $previous | ConvertTo-Json -Depth 6 | Set-Content -Path $cfgPath
    [IO.File]::WriteAllText((Join-Path $tmpDir 'agent.token'), 'old-device-token')
    [IO.File]::WriteAllText((Join-Path $tmpDir 'client.pfx'), 'not-a-real-pfx')

    # Plain HTTP, credentials in URLs and tokens on command line must be rejected.
    $blocked = $false
    try {
        & $wizard -ServerUrl 'http://insecure.example.test' -TokenFile $tokenFile -ConfigPath $cfgPath -NonInteractive | Out-Null
    } catch { $blocked = $true }
    if (-not $blocked) { throw 'Wizard accepted insecure HTTP' }

    $out = & $wizard -ServerUrl 'https://new.example.test' -TokenFile $tokenFile -ConfigPath $cfgPath -NonInteractive
    if (($out -join ' ') -match [regex]::Escape($singleUse)) { throw 'Wizard disclosed enrollment token in console output' }
    $actual = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
    if ($actual.endpoint -ne 'https://new.example.test/api/v1/ingest/telemetry') { throw 'Agent endpoint was not updated' }
    if ($actual.enroll_url -ne 'https://new.example.test/api/v1/agent/enroll') { throw 'Enrollment URL was not updated' }
    if ($actual.token -ne $singleUse -or $actual.needs_setup) { throw 'Agent was not configured' }
    if (@($actual.features).Count -ne 1) { throw 'Existing feature manifest was lost' }
    if (Test-Path (Join-Path $tmpDir 'agent.token')) { throw 'Old device identity token was not cleared' }
    if (Test-Path (Join-Path $tmpDir 'client.pfx')) { throw 'Old server client certificate was not cleared' }

    # Changing to the same server/token should preserve an already enrolled identity.
    [IO.File]::WriteAllText((Join-Path $tmpDir 'agent.token'), 'current-device-token')
    & $wizard -ServerUrl 'https://new.example.test' -TokenFile $tokenFile -ConfigPath $cfgPath -NonInteractive | Out-Null
    if (-not (Test-Path (Join-Path $tmpDir 'agent.token'))) { throw 'Idempotent reconfiguration discarded device token' }

    Write-Host 'Configure-Agent.ps1 regression tests passed.'
}
finally {
    Remove-Item -LiteralPath $tmpDir -Force -Recurse -ErrorAction SilentlyContinue
}
