# Verify a genuine test-only Windows MSI on an ephemeral Windows CI runner.
# NEVER execute on an administrator's production workstation.
[CmdletBinding()]
param(
    [string]$BuildOut = "$PSScriptRoot\..\build\out",
    [switch]$AllowDisposableVm
)
$ErrorActionPreference = 'Stop'
if (-not ($env:CI -eq 'true' -or $AllowDisposableVm)) {
    throw 'Installer lifecycle tests require CI=true or explicit -AllowDisposableVm on a disposable snapshot.'
}

$exe = Join-Path $BuildOut 'IT-Toolkit-Agent.exe'
$msi = Get-ChildItem -LiteralPath $BuildOut -Filter '*.msi' -File |
    Sort-Object Length -Descending | Select-Object -First 1
if (-not (Test-Path $exe -PathType Leaf)) { throw 'Real compiled EXE was not found.' }
if (-not $msi) { throw 'No real MSI was found.' }
if ($msi.Length -le 65536) { throw "MSI is implausibly small ($($msi.Length) bytes): placeholder detected." }
if ((Get-Item $exe).Length -le 10240) { throw 'EXE is too small to be a real ps2exe build.' }

# CFB (Compound File Binary) magic required for a genuine Windows Installer DB.
$stream = [IO.File]::OpenRead($msi.FullName)
try {
    $magic = New-Object byte[] 8
    if ($stream.Read($magic, 0, 8) -ne 8) { throw 'MSI file too small for header.' }
    $header = [BitConverter]::ToString($magic)
    if ($header -ne 'D0-CF-11-E0-A1-B1-1A-E1') {
        throw "Invalid MSI compound-file header: $header"
    }
}
finally { $stream.Dispose() }

# Windows Installer COM validates that this is a readable installation DB.
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $installer.OpenDatabase($msi.FullName, 0)
# Windows Installer SQL supports a restricted subset (no SQL IN clause).
$view = $db.OpenView('SELECT `Property`, `Value` FROM `Property`')
$view.Execute()
$metadata = @{}
while ($null -ne ($record = $view.Fetch())) {
    $metadata[[string]$record.StringData(1)] = [string]$record.StringData(2)
}
$view.Close()
foreach ($required in @('ProductCode','ProductName','ProductVersion','UpgradeCode')) {
    if (-not $metadata[$required]) { throw "Missing required MSI property: $required" }
}
if ($metadata['ProductName'] -notmatch 'IT-Toolkit Agent') { throw 'Wrong MSI product.' }

$configFile = Join-Path $BuildOut 'agent-config.json'
$cfg = Get-Content $configFile -Raw | ConvertFrom-Json
if ($cfg.token -or $cfg.bootstrap_token -or $cfg.device_token -or $cfg.command_signing_key) {
    throw 'MSI contains credential material. This unsigned test build must be credential-free.'
}
if ([string]$cfg.endpoint -notmatch '^https://') { throw 'Non-HTTPS agent endpoint in installer.' }
if ($cfg.deployment_state -ne 'UNENROLLED') { throw 'MSI must start un-enrolled.' }

$installLog = Join-Path $env:RUNNER_TEMP 'aaditech-msi-install.log'
$uninstallLog = Join-Path $env:RUNNER_TEMP 'aaditech-msi-uninstall.log'
$installed = $false
function Invoke-Msi {
    param([string]$Operation, [string]$LogPath)
    $args = @($Operation, ('"' + $msi.FullName + '"'), '/qn', '/norestart', '/L*v', ('"' + $LogPath + '"'))
    $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $args -Wait -PassThru
    if ($proc.ExitCode -notin @(0,3010)) {
        if (Test-Path $LogPath) {
            Get-Content $LogPath -Tail 85 | ForEach-Object { Write-Warning $_ }
        }
        throw "msiexec $Operation exited with code $($proc.ExitCode)."
    }
}
try {
    Invoke-Msi '/i' $installLog
    $installed = $true
    $installedExe = Join-Path $env:ProgramFiles 'IT-Toolkit\IT-Toolkit-Agent.exe'
    $installedConfig = Join-Path $env:ProgramData 'ITToolkit-Agent\agent.json'
    if (-not (Test-Path $installedExe -PathType Leaf)) {
        throw "MSI did not install its real executable at $installedExe"
    }
    if (-not (Test-Path $installedConfig -PathType Leaf)) {
        throw "MSI did not install runtime configuration at $installedConfig"
    }
    $foundTask = & schtasks.exe /Query /TN ITToolkitAgent 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Expected least-privilege scheduled task ITToolkitAgent missing.' }
    Write-Host '[Windows installer] Scheduled task verified.'
}
finally {
    if ($installed) {
        Invoke-Msi '/x' $uninstallLog
        $installed = $false
    }
}
if (Test-Path (Join-Path $env:ProgramFiles 'IT-Toolkit\IT-Toolkit-Agent.exe')) {
    throw 'MSI uninstall left the agent EXE installed.'
}
& schtasks.exe /Query /TN ITToolkitAgent 2>$null | Out-Null
$taskStillPresent = ($LASTEXITCODE -eq 0)
# The expected nonzero exit code from querying a removed task must not poison
# the PowerShell step's final process exit code after all assertions pass.
$global:LASTEXITCODE = 0
if ($taskStillPresent) { throw 'Scheduled task remained after MSI uninstall.' }

$exeHash = (Get-FileHash $exe -Algorithm SHA256).Hash
$msiHash = (Get-FileHash $msi.FullName -Algorithm SHA256).Hash
Write-Host "[Windows installer] PASS: genuine EXE and MSI, successful install/uninstall, task cleanup."
Write-Host "[Windows installer] MSI $($msi.Name): $($msi.Length) bytes; SHA256=$msiHash"
Write-Host "[Windows installer] EXE SHA256=$exeHash"
Write-Warning 'TEST-ONLY unsigned artifact. Do not publish to production endpoints.'
