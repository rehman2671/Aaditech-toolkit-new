# build-msi.ps1 - produces IT-Toolkit-Agent-<version>.msi.
#
# Stages the built agent exe, its config, and the toolkit files it wraps into
# wix\stage\ (the WXS references stage\...), then invokes WiX.
#
# Prereqs: WiX v5 toolset (`dotnet tool install --global wix --version "5.*"`).
# (WiX v7 requires accepting the OSMF EULA; v5 is MIT and uses the same v4 WXS schema.)
# Steps:
#   1. run Enterprise/agent/build/build-agent.ps1  (produces build/out/)
#   2. run this script                               (produces build/out/IT-Toolkit-Agent-<version>.msi)

[CmdletBinding()]
param(
    [string]$BuildOut = "$PSScriptRoot\..\build\out",
    [string]$WixDir = $PSScriptRoot,
    [string]$RepoRoot = "$PSScriptRoot\..\..\.."
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $BuildOut 'IT-Toolkit-Agent.exe'))) {
    throw "build/out/IT-Toolkit-Agent.exe missing. Run build-agent.ps1 first."
}
if (-not (Test-Path (Join-Path $BuildOut 'agent-config.json'))) {
    throw "build/out/agent-config.json missing. Run build-agent.ps1 first."
}

$Stage = Join-Path $WixDir 'stage'
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

Copy-Item (Join-Path $BuildOut 'IT-Toolkit-Agent.exe') (Join-Path $Stage 'IT-Toolkit-Agent.exe') -Force
Copy-Item (Join-Path $BuildOut 'agent-config.json') (Join-Path $Stage 'agent.json') -Force

# Ship a first-run/reconfiguration wizard in the MSI itself. An MSI built
# before the SaaS host exists must be configurable after installation.
$wizard = Join-Path $RepoRoot 'Enterprise\agent\Configure-Agent.ps1'
if (-not (Test-Path -LiteralPath $wizard -PathType Leaf)) {
    throw "Required Windows agent setup wizard missing: $wizard"
}
Copy-Item -LiteralPath $wizard -Destination (Join-Path $Stage 'Configure-Agent.ps1') -Force
$guiWizard = Join-Path $RepoRoot 'Enterprise\agent\Configure-Agent-GUI.ps1'
if (-not (Test-Path -LiteralPath $guiWizard -PathType Leaf)) {
    throw "Required Windows GUI setup wizard missing: $guiWizard"
}
Copy-Item -LiteralPath $guiWizard -Destination (Join-Path $Stage 'Configure-Agent-GUI.ps1') -Force

# Bundle the official sqlite3.exe CLI so the agent's outbox queue works on
# stock Windows with no system-wide SQLite install. The agent prepends this
# directory to PATH at startup (see Agent-Collect.ps1), which the shared
# ToolkitData module's `sqlite3` lookups then pick up.
$sqliteVer = '3530400'
$sqliteUrl  = "https://www.sqlite.org/2026/sqlite-tools-win-x64-$sqliteVer.zip"
$stageSqlite = Join-Path $Stage 'sqlite3.exe'
if (-not (Test-Path $stageSqlite)) {
    Write-Host "Downloading sqlite3.exe ($sqliteUrl)"
    $sqliteZip  = Join-Path $env:TEMP "sqlite-tools-win-x64-$sqliteVer.zip"
    $extractDir = Join-Path $env:TEMP "sqlite-tools-win-x64-$sqliteVer"
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    try {
        Invoke-WebRequest $sqliteUrl -OutFile $sqliteZip -UseBasicParsing
        Expand-Archive $sqliteZip -DestinationPath $extractDir -Force
        # The zip's internal layout has varied between releases; find sqlite3.exe
        # wherever it landed instead of assuming a fixed nested path.
        $sqliteExe = Get-ChildItem $extractDir -Recurse -Filter sqlite3.exe -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($sqliteExe) { Copy-Item $sqliteExe.FullName $stageSqlite -Force }
    }
    finally {
        if (Test-Path $sqliteZip)  { Remove-Item $sqliteZip -Force -ErrorAction SilentlyContinue }
    }
    if (-not (Test-Path $stageSqlite)) { throw "Failed to fetch sqlite3.exe from $sqliteUrl" }
}
Write-Host "Staged sqlite3.exe ($($(Get-Item $stageSqlite).Length) bytes)"

# bundle the toolkit files the agent wraps (scripts + modules + config)
Copy-Item (Join-Path $RepoRoot 'Scripts') (Join-Path $Stage 'Scripts') -Recurse -Force
Copy-Item (Join-Path $RepoRoot 'Config')  (Join-Path $Stage 'Config')  -Recurse -Force

# E4: on-demand elevated helper (registers ITToolkitAgentElevated with a
# security descriptor that lets the NETWORK SERVICE agent trigger it).
Copy-Item (Join-Path $WixDir 'Create-ElevatedTask.ps1') (Join-Path $Stage 'Scripts\Create-ElevatedTask.ps1') -Force

# bundle the support-engineer collectors (installed as <root>\Enterprise\agent\collectors\,
# same relative path the agent.json feature scripts use in the repo)
$collectors = Join-Path $RepoRoot 'Enterprise\agent\collectors'
if (Test-Path $collectors) {
    $stageCollectors = Join-Path $Stage 'Enterprise\agent\collectors'
    New-Item -ItemType Directory -Path $stageCollectors -Force | Out-Null
    Copy-Item (Join-Path $collectors '*.ps1') $stageCollectors -Force
}

$wix = Get-Command wix -ErrorAction SilentlyContinue
if (-not $wix) { throw "WiX toolset not found. Install: dotnet tool install --global wix" }

# Agent version + interval come from agent/agent-version.json (single source of
# truth, A2). WiX preprocessor vars are injected here so the MSI product code
# and scheduled-task interval never drift from bundle.py / deploy scripts.
$metaRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$agentMeta = Get-Content (Join-Path $metaRoot 'agent\agent-version.json') -Raw | ConvertFrom-Json
$AgentVersion = [string]$agentMeta.agent_version
$AgentInterval = [string]$agentMeta.interval_minutes

# Windows Installer compares only THREE ProductVersion fields.
# The older date-in-fourth-field scheme never changed the upgrade order.
# Pack explicit semver patch and a monotonically maintained MSI revision
# into field three: Major.Minor.(Patch * 1000 + MsiRevision). This upgrades
# previously published 1.1.2.<date> installers because 1.1.2001 > 1.1.2.
# Never silently use the clock: release builds must be reproducible.
$match = [regex]::Match($AgentVersion, '^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$')
if (-not $match.Success) {
    throw 'agent_version must be numeric major.minor.patch for an MSI release.'
}
$maj = [int]$match.Groups['major'].Value
$min = [int]$match.Groups['minor'].Value
$pat = [int]$match.Groups['patch'].Value
$revision = 0
if ($null -ne $agentMeta.msi_revision) {
    if ("$($agentMeta.msi_revision)" -cnotmatch '^(0|[1-9][0-9]{0,2})$') {
        throw 'msi_revision must be an integer between 0 and 999.'
    }
    $revision = [int]$agentMeta.msi_revision
}
if ($maj -gt 255 -or $min -gt 255 -or $pat -gt 64) {
    throw 'MSI version bounds exceeded: major/minor <=255 and patch <=64.'
}
if ($revision -lt 1) { throw 'Explicit positive msi_revision is required for release builds.' }
$build = $pat * 1000 + $revision
$MsiVersion = "$maj.$min.$build"
Write-Host "Baking AgentVersion=$AgentVersion AgentInterval=$AgentInterval MsiVersion=$MsiVersion (revision=$revision)"

# Run wix from the WXS directory so its relative Source paths (stage\...) resolve
# against the WXS location regardless of the caller's working directory.
Push-Location $WixDir
try {
    # Versioned artifact name so every build is distinguishable at a glance:
    # IT-Toolkit-Agent-<semver>.msi (semver, NOT the 4-part upgrade revision).
    $MsiName = "IT-Toolkit-Agent-$AgentVersion.msi"
    # WiX v5 defaults to x86 unless -arch is explicit; the agent bundles an
    # x64 sqlite3.exe and installs under ProgramFiles64Folder. A default x86
    # package may redirect its payload into Program Files (x86), breaking the
    # canonical first-run/setup paths on real machines.
    & $wix.Source build -arch x64 'Agent.wxs' -o "$(Join-Path $BuildOut $MsiName)" -d "AgentVersion=$MsiVersion" -d "AgentInterval=$AgentInterval"
    if ($LASTEXITCODE -ne 0) { throw "WiX build failed with exit code $LASTEXITCODE (see output above)" }
}
finally {
    Pop-Location
}

$MsiPath = Join-Path $BuildOut $MsiName
if (-not (Test-Path $MsiPath)) {
    throw "WiX build reported success but no MSI was produced at $MsiPath"
}

Write-Host "MSI built: $MsiPath"
Write-Host "Deploy with: msiexec /i $MsiName /qn   (or push via Intune/GPO/SCCM)"
