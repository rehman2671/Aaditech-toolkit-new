# Requires PowerShell 5.1+. Exercises the generic MSI's post-install wizard.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$wizard = Join-Path $root 'agent\Configure-Agent.ps1'
$guiWizard = Join-Path $root 'agent\Configure-Agent-GUI.ps1'
$wxs = Join-Path $root 'agent\wix\Agent.wxs'
$builder = Join-Path $root 'agent\wix\build-msi.ps1'

$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($wizard, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) {
    throw "Wizard has parser errors: $($parseErrors | ForEach-Object Message | Out-String)"
}
$guiParseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($guiWizard, [ref]$tokens, [ref]$guiParseErrors) | Out-Null
if ($guiParseErrors.Count -gt 0) {
    throw "GUI wizard has parser errors: $($guiParseErrors | ForEach-Object Message | Out-String)"
}
[xml]$manifest = Get-Content -LiteralPath $wxs -Raw
if (-not $manifest.SelectSingleNode('//*[local-name()="Component" and @Id="AgentSetupWizard"]')) {
    throw 'WiX installer does not contain Configure-Agent.ps1 component'
}
if (-not (Get-Content $builder -Raw).Contains("Configure-Agent.ps1")) {
    throw 'MSI build is not staging Configure-Agent.ps1'
}
if (-not $manifest.SelectSingleNode('//*[local-name()="Component" and @Id="AgentSetupGui"]')) {
    throw 'MSI does not install graphical setup script'
}
$runtimeComponent = $manifest.SelectSingleNode('//*[local-name()="Component" and @Id="AgentConfig"]')
if (-not $runtimeComponent -or $runtimeComponent.NeverOverwrite -ne 'yes' -or
    $runtimeComponent.Permanent -ne 'yes') {
    throw 'MSI must preserve the tenant/server runtime config across major upgrades'
}
if (-not $manifest.SelectSingleNode('//*[local-name()="Shortcut" and @Id="AgentSetupMenuShortcut"]')) {
    throw 'MSI does not expose Start Menu graphical setup shortcut'
}
if (-not $manifest.SelectSingleNode('//*[local-name()="ComponentRef" and @Id="AgentSetupMenu"]')) {
    throw 'MSI feature does not include the Start Menu shortcut'
}
foreach ($actionName in @('HardenRuntimeJsonAcl', 'HardenAgentDataAcl', 'HardenLocalJsonAcl')) {
    $action = $manifest.SelectSingleNode("//*[local-name()='CustomAction' and @Id='$actionName']")
    if (-not $action -or $action.Return -ne 'check') {
        throw "MSI credential hardening must fail installation on failure: $actionName"
    }
    if ($action.ExeCommand -match ' /C(?:\s|$)') {
        throw "MSI ACL hardening must never continue after a protected-file permission error: $actionName"
    }
}
$runtimeAcl = $manifest.SelectSingleNode("//*[local-name()='CustomAction' and @Id='HardenRuntimeJsonAcl']")
if ($runtimeAcl.ExeCommand -notmatch 'ITToolkit-Agent\\agent.json') {
    throw 'MSI does not explicitly protect the runtime agent.json file'
}
$directoryAcl = $manifest.SelectSingleNode("//*[local-name()='CustomAction' and @Id='HardenAgentDataAcl']")
if ($directoryAcl.ExeCommand -match ' /T(?:\s|$)') {
    throw 'Recursive directory ACL rewriting destroys existing enrolled-token inheritance on upgrade'
}
if (-not (Get-Content $builder -Raw).Contains('Configure-Agent-GUI.ps1')) {
    throw 'MSI build does not stage GUI setup script'
}
if (-not (Get-Content $builder -Raw).Contains('build -arch x64')) {
    throw 'MSI build must explicitly target x64 instead of WiX default x86'
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
    [IO.File]::WriteAllText((Join-Path $tmpDir 'agent.identity.json'), '{"device_id":"old","tenant_id":"old-tenant"}')

    # Plain HTTP, credentials in URLs and tokens on command line must be rejected.
    $blocked = $false
    try {
        & $wizard -ServerUrl 'http://insecure.example.test' -TokenFile $tokenFile -ConfigPath $cfgPath -NonInteractive | Out-Null
    } catch { $blocked = $true }
    if (-not $blocked) { throw 'Wizard accepted insecure HTTP' }

    # Simulate a legacy explicit world-readable file and directory. The
    # first-run wizard must REMOVE these ACEs, not merely /grant:r its
    # private SIDs while leaving unrelated explicit permissions in place.
    if ($env:OS -eq 'Windows_NT') {
        & icacls.exe $tmpDir /grant '*S-1-1-0:(OI)(CI)R' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot seed world-readable test directory' }
        & icacls.exe $cfgPath /grant '*S-1-1-0:R' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot seed legacy world-readable config' }
    }

    $out = & $wizard -ServerUrl 'https://new.example.test' -TokenFile $tokenFile -ConfigPath $cfgPath -NonInteractive
    if (($out -join ' ') -match [regex]::Escape($singleUse)) { throw 'Wizard disclosed enrollment token in console output' }
    $actual = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
    if ($actual.endpoint -ne 'https://new.example.test/api/v1/ingest/telemetry') { throw 'Agent endpoint was not updated' }
    if ($actual.enroll_url -ne 'https://new.example.test/api/v1/agent/enroll') { throw 'Enrollment URL was not updated' }
    if ($actual.token -ne $singleUse -or $actual.needs_setup) { throw 'Agent was not configured' }
    if ($env:OS -eq 'Windows_NT') {
        foreach ($protectedPath in @($tmpDir, $cfgPath)) {
            $acl = Get-Acl -LiteralPath $protectedPath
            if (-not $acl.AreAccessRulesProtected -or @($acl.Access).Count -ne 3) {
                throw "Wizard did not install a private, explicit credential ACL: $protectedPath"
            }
            $observed = @($acl.Access | ForEach-Object {
                $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            } | Sort-Object)
            $expected = @('S-1-5-18', 'S-1-5-20', 'S-1-5-32-544' | Sort-Object)
            if (@(Compare-Object $observed $expected).Count -ne 0) {
                throw "Wizard retained unsafe explicit read grants: $protectedPath"
            }
        }
        $source = Get-Content -LiteralPath $wizard -Raw
        $privateTemp = $source.IndexOf('Set-PrivateAgentAcl -Path $temp -IsDirectory $false')
        $secretWrite = $source.IndexOf('[System.IO.File]::WriteAllText($temp, $json')
        if ($privateTemp -lt 0 -or $secretWrite -lt 0 -or $privateTemp -ge $secretWrite) {
            throw 'Wizard must protect the temporary credential file before writing the token'
        }
    }

    if (@($actual.features).Count -ne 1) { throw 'Existing feature manifest was lost' }
    if (Test-Path (Join-Path $tmpDir 'agent.token')) { throw 'Old device identity token was not cleared' }
    if (Test-Path (Join-Path $tmpDir 'client.pfx')) { throw 'Old server client certificate was not cleared' }
    if (Test-Path (Join-Path $tmpDir 'agent.identity.json')) { throw 'Old tenant/device identity was not cleared' }

    # Changing to the same server/token should preserve an already enrolled identity.
    [IO.File]::WriteAllText((Join-Path $tmpDir 'agent.token'), 'current-device-token')
    & $wizard -ServerUrl 'https://new.example.test' -TokenFile $tokenFile -ConfigPath $cfgPath -NonInteractive | Out-Null
    if (-not (Test-Path (Join-Path $tmpDir 'agent.token'))) { throw 'Idempotent reconfiguration discarded device token' }

    # GUI supplies a SecureString directly; secret must never be passed in CLI
    # arguments or persisted to a temporary plaintext token file.
    $secure = ConvertTo-SecureString -String $singleUse -AsPlainText -Force
    try {
        $result = & $wizard -ServerUrl 'https://new.example.test' -EnrollmentToken $secure -ConfigPath $cfgPath -NonInteractive
        if (($result -join ' ') -match [regex]::Escape($singleUse)) {
            throw 'SecureString setup exposed token in output'
        }
    }
    finally { $secure.Dispose() }
    if (-not (Test-Path (Join-Path $tmpDir 'agent.token'))) {
        throw 'SecureString reconfiguration discarded a valid device token'
    }

    # A freshly installed generic MSI has no endpoint/token keys yet.
    # Exercise this path under strict mode so missing Hashtable properties
    # cannot silently pass until the slower real MSI smoke test catches them.
    $blankConfigPath = Join-Path $tmpDir 'fresh-agent.json'
    & {
        Set-StrictMode -Version Latest
        & $wizard -ServerUrl 'https://fresh.example.test' -TokenFile $tokenFile `
            -ConfigPath $blankConfigPath -NonInteractive | Out-Null
    }
    $fresh = Get-Content -LiteralPath $blankConfigPath -Raw | ConvertFrom-Json
    if ($fresh.endpoint -ne 'https://fresh.example.test/api/v1/ingest/telemetry' -or
        $fresh.token -ne $singleUse -or $fresh.needs_setup) {
        throw 'Fresh empty-config setup failed strict-mode first-run regression'
    }
    if ($env:OS -eq 'Windows_NT') {
        $freshAcl = Get-Acl -LiteralPath $blankConfigPath
        if (-not $freshAcl.AreAccessRulesProtected -or @($freshAcl.Access).Count -ne 3) {
            throw 'Fresh setup wrote token before private credential ACL was established'
        }
    }

    Write-Host 'Configure-Agent.ps1 regression tests passed.'
}
finally {
    Remove-Item -LiteralPath $tmpDir -Force -Recurse -ErrorAction SilentlyContinue
}
