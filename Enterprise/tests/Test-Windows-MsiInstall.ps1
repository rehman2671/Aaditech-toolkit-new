#Requires -Version 5.1
<#
.SYNOPSIS
  CI-only integration rehearsal for the actual Windows Installer package.
.DESCRIPTION
  Requires an isolated, elevated Windows GitHub Actions runner. Installs and
  uninstalls the unsigned diagnostic MSI (never publishes it) and validates
  the Program Files payload, ProgramData ACL, scheduled task and Start Menu.
  This is not a substitute for signed-artifact / end-user Windows acceptance.
#>
[CmdletBinding()]
param(
    [string]$MsiPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or
    -not $env:RUNNER_TEMP) {
    throw 'MSI installation rehearsal is restricted to an isolated GitHub Actions Windows runner.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Windows MSI integration test must run elevated.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $MsiPath) {
    $found = Get-ChildItem (Join-Path $repoRoot 'Enterprise\agent\build\out') -Filter 'IT-Toolkit-Agent-*.msi' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $found) { throw 'No generated Windows MSI found in build/out.' }
    $MsiPath = $found.FullName
}
$MsiPath = (Resolve-Path -LiteralPath $MsiPath).Path
$metadata = Get-Content (Join-Path $repoRoot 'Enterprise\agent\agent-version.json') -Raw | ConvertFrom-Json
$parts = ([string]$metadata.agent_version).Split('.')
if ($parts.Length -ne 3) { throw 'MSI integration test requires three-field agent semver.' }
$expectedBuild = ([int]$parts[2] * 1000) + [int]$metadata.msi_revision
$expectedMsiVersion = ('{0}.{1}.{2}' -f $parts[0], $parts[1], $expectedBuild)

# Read actual ProductVersion from the MSI database. The fourth field of
# ProductVersion would be ignored by Windows Installer upgrade comparisons.
$installer = New-Object -ComObject WindowsInstaller.Installer
$msiDatabase = $installer.OpenDatabase($MsiPath, 0)
$view = $msiDatabase.OpenView("SELECT Value FROM Property WHERE Property = 'ProductVersion'")
try {
    $view.Execute()
    $versionRecord = $view.Fetch()
    if (-not $versionRecord) { throw 'MSI ProductVersion property is missing.' }
    $productVersion = [string]$versionRecord.StringData(1)
} finally {
    $view.Close()
}
if ($productVersion -cne $expectedMsiVersion -or $productVersion.Split('.').Length -ne 3) {
    throw "MSI ProductVersion '$productVersion' != explicit release revision '$expectedMsiVersion'."
}
# The agent bundles an x64 SQLite binary, so installing an implicit x86 MSI
# could redirect the executable into Program Files (x86), breaking the
# documented setup path even though msiexec itself exits successfully.
$template = [string]$installer.SummaryInformation($MsiPath, 0).Property(7)
if ($template -notmatch '^x64;') {
    throw "MSI architecture is not x64 (Template=$template). Check wix build -arch x64."
}
Write-Host "Windows Installer version/architecture verified: $productVersion ($template)"

$logDir = Join-Path $env:RUNNER_TEMP 'itk-msi-install-rehearsal'
New-Item -Path $logDir -ItemType Directory -Force | Out-Null
$installLog = Join-Path $logDir 'install.log'
$uninstallLog = Join-Path $logDir 'uninstall.log'
$installDir = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'IT-Toolkit'
$dataDir = Join-Path $env:ProgramData 'ITToolkit-Agent'
$startMenu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'IT-Toolkit\Configure Agent Server.lnk'
$installed = $false
$cleanupError = $null
try {
    $args = "/i `"$MsiPath`" /qn /norestart REBOOT=ReallySuppress /l*v `"$installLog`""
    $proc = Start-Process -FilePath msiexec.exe -ArgumentList $args -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "Real MSI installation failed: exit $($proc.ExitCode). Log: $installLog"
    }
    $installed = $true
    foreach ($required in @(
        (Join-Path $installDir 'IT-Toolkit-Agent.exe'),
        (Join-Path $installDir 'Configure-Agent.ps1'),
        (Join-Path $installDir 'Configure-Agent-GUI.ps1'),
        (Join-Path $installDir 'sqlite3.exe'),
        (Join-Path $dataDir 'agent.json')
    )) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Installed MSI missing required payload: $required"
        }
    }

    # Diagnose effective on-disk permissions on an ephemeral runner without
    # ever logging the protected token/config contents.
    Write-Host 'Installed agent credential ACLs (metadata only):'
    & icacls.exe $dataDir
    & icacls.exe (Join-Path $dataDir 'agent.json')
    & icacls.exe (Join-Path $installDir 'agent.json')
    foreach ($configPath in @((Join-Path $dataDir 'agent.json'), (Join-Path $installDir 'agent.json'))) {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if (-not $config.needs_setup -or $config.endpoint -or $config.token -or
            $config.bootstrap_token -or $config.enroll_url) {
            throw "Installed MSI contains provisioned hostname or credential: $configPath"
        }
    }
    $task = Get-ScheduledTask -TaskName 'ITToolkitAgent' -ErrorAction SilentlyContinue
    if (-not $task) { throw 'MSI did not create the routine ITToolkitAgent scheduled task.' }
    if ([string]$task.Principal.UserId -notmatch 'NETWORK SERVICE|S-1-5-20') {
        throw "MSI task does not run as least-privileged NETWORK SERVICE: $($task.Principal.UserId)"
    }
    if (-not (Test-Path -LiteralPath $startMenu -PathType Leaf)) {
        throw "MSI did not create graphical Start Menu setup shortcut: $startMenu"
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($startMenu)
    if ($shortcut.Arguments -notmatch 'Configure-Agent-GUI\.ps1' -or
        $shortcut.Arguments -notmatch '\-STA') {
        throw 'Start Menu shortcut does not launch the PowerShell graphical server wizard.'
    }

    # The agent runs as NETWORK SERVICE and writes per-device secrets. The
    # ProgramData parent must not inherit a broad Users/Everyone read ACL.
    $acl = Get-Acl -LiteralPath $dataDir
    if (-not $acl.AreAccessRulesProtected) {
        throw 'ProgramData agent credential directory still inherits potentially public ACLs.'
    }

    # Exercise the INSTALLED CLI script, not the repo copy. No server has
    # been deployed; use an invalid test DNS hostname without connecting.
    $tempConfig = Join-Path $logDir 'agent-test.json'
    $secretValue = 'ci-only-temporary-bootstrap-credential-123456789'
    $secure = ConvertTo-SecureString -String $secretValue -AsPlainText -Force
    try {
        $messages = & (Join-Path $installDir 'Configure-Agent.ps1') `
            -ServerUrl 'https://ci.invalid.example' -EnrollmentToken $secure `
            -ConfigPath $tempConfig -NonInteractive
        if (($messages -join ' ') -match [regex]::Escape($secretValue)) {
            throw 'Installed configuration wizard printed the enrollment credential.'
        }
    } finally {
        $secure.Dispose()
    }
    $cfg = Get-Content -LiteralPath $tempConfig -Raw | ConvertFrom-Json
    if ($cfg.endpoint -ne 'https://ci.invalid.example/api/v1/ingest/telemetry' -or
        $cfg.token -ne $secretValue -or $cfg.needs_setup) {
        throw 'Installed MSI setup wizard did not persist the intended HTTPS server configuration.'
    }
    # The published on-machine config must remain blank until the user
    # explicitly runs first-run setup for their real deployed server.
    $onMachine = Get-Content -LiteralPath (Join-Path $dataDir 'agent.json') -Raw | ConvertFrom-Json
    if (-not $onMachine.needs_setup -or $onMachine.token) {
        throw 'Smoke-test reconfiguration modified the packaged runtime config.'
    }
    Write-Host 'Real MSI installation, blank configuration, ACL, task, shortcut and installed wizard checks passed.'
}
finally {
    if ($installed) {
        $args = "/x `"$MsiPath`" /qn /norestart REBOOT=ReallySuppress /l*v `"$uninstallLog`""
        $proc = Start-Process -FilePath msiexec.exe -ArgumentList $args -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            $cleanupError = "MSI uninstall failed: exit $($proc.ExitCode). Log: $uninstallLog"
        } else {
            if (Get-ScheduledTask -TaskName 'ITToolkitAgent' -ErrorAction SilentlyContinue) {
                $cleanupError = 'MSI uninstall left the routine scheduled task registered.'
            }
            if (Test-Path -LiteralPath $startMenu -PathType Leaf) {
                $cleanupError = 'MSI uninstall left the setup Start Menu shortcut registered.'
            }
        }
    }
}
if ($cleanupError) { throw $cleanupError }
Write-Host 'MSI uninstall and scheduled-task/shortcut cleanup passed.'
