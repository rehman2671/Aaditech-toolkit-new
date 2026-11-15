#Requires -Version 5.1
<#
.SYNOPSIS
  CI-only Windows Installer major-upgrade state preservation rehearsal.
.DESCRIPTION
  On a disposable elevated GitHub Windows runner, builds a second diagnostic
  revision from the same staged files, upgrades the installed product, checks
  that tenant/server configuration remains intact, and removes the candidate.
  Does not publish either unsigned diagnostic package.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or
    -not $env:RUNNER_TEMP) { throw 'MSI upgrade rehearsal requires a disposable Windows Actions runner.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'MSI upgrade rehearsal requires an elevated Windows runner.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$buildOut = Join-Path $repoRoot 'Enterprise\agent\build\out'
$wixDir = Join-Path $repoRoot 'Enterprise\agent\wix'
$meta = Get-Content (Join-Path $repoRoot 'Enterprise\agent\agent-version.json') -Raw | ConvertFrom-Json
$baseMsi = Get-ChildItem -Path $buildOut -Filter 'IT-Toolkit-Agent-*.msi' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $baseMsi) { throw 'Base MSI missing; build it before the upgrade test.' }
$parts = ([string]$meta.agent_version).Split('.')
if ($parts.Count -ne 3) { throw 'Invalid three-part agent version metadata' }
$baseBuild = ([int]$parts[2] * 1000) + [int]$meta.msi_revision
if ($baseBuild -ge 65535) { throw 'Upgrade test cannot exceed Windows Installer product version limit.' }
$baseVersion = ('{0}.{1}.{2}' -f $parts[0], $parts[1], $baseBuild)
$candidateVersion = ('{0}.{1}.{2}' -f $parts[0], $parts[1], ($baseBuild + 1))
$interval = [int]$meta.interval_minutes

function Read-MsiProperty([string]$File, [string]$Name) {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($File, 0)
    $view = $database.OpenView("SELECT Value FROM Property WHERE Property = '$Name'")
    try {
        $null = $view.Execute()
        $row = $view.Fetch()
        if (-not $row) { throw "MSI property missing: $Name" }
        $value = [string]$row.StringData(1)
        return $value
    } finally { $null = $view.Close() }
}
$baseVersionActual = [string](Read-MsiProperty $baseMsi.FullName 'ProductVersion')
Write-Host "MSI upgrade test base version: actual=<$baseVersionActual>, expected=<$baseVersion>"
if ($baseVersionActual -cne $baseVersion) {
    throw "Base MSI ProductVersion '$baseVersionActual' differs from '$baseVersion'."
}

$wix = Get-Command wix -ErrorAction SilentlyContinue
if (-not $wix) {
    $env:Path = "$env:USERPROFILE\.dotnet\tools;$env:Path"
    $wix = Get-Command wix -ErrorAction Stop
}
$upgradeMsi = Join-Path $env:RUNNER_TEMP 'itk-diagnostic-major-upgrade.msi'
Push-Location $wixDir
try {
    & $wix.Source build -arch x64 'Agent.wxs' -o $upgradeMsi `
        -d "AgentVersion=$candidateVersion" -d "AgentInterval=$interval"
    if ($LASTEXITCODE -ne 0) { throw "WiX upgrade candidate build failed: $LASTEXITCODE" }
} finally { Pop-Location }
if ((Read-MsiProperty $upgradeMsi 'ProductVersion') -cne $candidateVersion) {
    throw 'Diagnostic upgrade MSI ProductVersion is incorrect.'
}
$oldProduct = Read-MsiProperty $baseMsi.FullName 'ProductCode'
$newProduct = Read-MsiProperty $upgradeMsi 'ProductCode'
if ($oldProduct -eq $newProduct) { throw 'MajorUpgrade requires distinct ProductCode values.' }

$logs = Join-Path $env:RUNNER_TEMP 'itk-msi-upgrade-rehearsal'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$runtimeDir = Join-Path $env:ProgramData 'ITToolkit-Agent'
$configPath = Join-Path $runtimeDir 'agent.json'
$installedWizard = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'IT-Toolkit\Configure-Agent.ps1'
$token = 'ci-upgrade-bootstrap-only-123456789012345'
$endpoint = 'https://upgrade-test.invalid.example'
$installed = $false
$cleanupMsi = $baseMsi.FullName
$cleanupFailure = ''
function Invoke-Msi([string]$mode, [string]$msi, [string]$logFile) {
    $args = "$mode `"$msi`" /qn /norestart REBOOT=ReallySuppress /l*v `"$logFile`""
    $proc = Start-Process msiexec.exe -ArgumentList $args -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "msiexec $mode failed (exit $($proc.ExitCode)); log: $logFile"
    }
}
try {
    Invoke-Msi '/i' $baseMsi.FullName (Join-Path $logs 'install-base.log')
    $installed = $true
    if (-not (Test-Path -LiteralPath $installedWizard -PathType Leaf)) {
        throw 'Base MSI did not install the expected setup wizard.'
    }
    $sec = ConvertTo-SecureString -String $token -AsPlainText -Force
    try {
        & $installedWizard -ServerUrl $endpoint -EnrollmentToken $sec `
            -ConfigPath $configPath -NonInteractive | Out-Null
    } finally { $sec.Dispose() }
    $before = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($before.token -cne $token -or $before.endpoint -cne "$endpoint/api/v1/ingest/telemetry" -or $before.needs_setup) {
        throw 'Test fixture could not configure the installed agent.'
    }

    # A registered device may have its own identity and token already
    # provisioned; a major MSI upgrade must not wipe or rotate these.
    $deviceTokenFile = Join-Path $runtimeDir 'agent.token'
    $identityFile = Join-Path $runtimeDir 'agent.identity.json'
    $deviceToken = 'itk_dev_ci_upgraded_device_credential'
    [IO.File]::WriteAllText($deviceTokenFile, $deviceToken)
    [IO.File]::WriteAllText($identityFile, '{"device_id":"ci-device","tenant_id":"ci-tenant","device_uid":"ci-uid"}')

    Invoke-Msi '/i' $upgradeMsi (Join-Path $logs 'upgrade.log')
    $cleanupMsi = $upgradeMsi

    $after = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($after.endpoint -cne $before.endpoint -or $after.token -cne $token -or
        $after.enroll_url -cne $before.enroll_url -or $after.needs_setup) {
        throw 'Major MSI upgrade replaced the previously configured HTTPS server/tenant bootstrap settings.'
    }
    if (-not (Test-Path -LiteralPath $deviceTokenFile -PathType Leaf) -or
        -not (Test-Path -LiteralPath $identityFile -PathType Leaf)) {
        throw 'Major MSI upgrade discarded enrolled device credentials or tenant identity.'
    }
    if ((Get-Content -LiteralPath $deviceTokenFile -Raw) -cne $deviceToken) {
        throw 'Major MSI upgrade unexpectedly rotated the enrolled device credential.'
    }
    if (-not (Get-ScheduledTask -TaskName 'ITToolkitAgent' -ErrorAction SilentlyContinue)) {
        throw 'Major MSI upgrade removed the scheduled agent task.'
    }
    Write-Host "Major MSI upgrade $baseVersion -> $candidateVersion passed and retained HTTPS/tenant/device configuration."
}
finally {
    if ($installed) {
        try {
            Invoke-Msi '/x' $cleanupMsi (Join-Path $logs 'uninstall-upgraded.log')
            if (Get-ScheduledTask -TaskName 'ITToolkitAgent' -ErrorAction SilentlyContinue) {
                $cleanupFailure = 'Major-upgrade uninstall left scheduled task registered.'
            }
        } catch {
            $cleanupFailure = $_.Exception.Message
        }
    }
}
if ($cleanupFailure) { throw $cleanupFailure }
Write-Host 'Upgraded MSI uninstall and task cleanup passed.'
