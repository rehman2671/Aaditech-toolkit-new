# build-msi.ps1 - produces IT-Toolkit-Agent-<version>.msi.
#
# Stages the built agent exe, its config, and the toolkit files it wraps into
# wix\stage\ (the WXS references stage\...), then invokes WiX.
#
# Prereqs: reviewed WiX v5.0.2 (`dotnet tool install --global wix --version 5.0.2`).
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

# N54: production-signable MSI payloads must be sourced from independently
# approved SQLite ZIP+EXE hashes. Diagnostic CI is deliberately non-publishable.
# In Actions a missing release-mode flag is an error, never an implicit
# downgrade from a planned release to an unpinned diagnostic.
Import-Module -Name (Join-Path $PSScriptRoot 'SqliteBundleApproval.psm1') -Force -ErrorAction Stop
if ($env:GITHUB_ACTIONS -ceq 'true' -and
    $env:RELEASE_SIGNING_ENABLED -cnotin @('true','false')) {
    throw 'Signing mode must be explicitly established before packaging.'
}
$releasePackage = ($env:RELEASE_SIGNING_ENABLED -ceq 'true')
if ($releasePackage -and ($env:SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED -cnotmatch '\A[0-9A-Fa-f]{64}\z' -or
                         $env:SQLITE3_EXE_SHA256_APPROVED -cnotmatch '\A[0-9A-Fa-f]{64}\z')) {
    throw 'N54 SQLite independently approved ZIP and EXE pins required before download.'
}
if (-not $releasePackage) {
    Write-Warning 'N54: diagnostic MSI only; SQLite artifact pins are NOT production-verified. Publication prohibited.'
}

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

# Bundle the official sqlite3.exe CLI; the worker needs it on a stock
# Windows endpoint. Diagnostic CI may use unpinned bytes but may never
# publish them. Every production-signable package requires independent,
# version-specific ZIP and extracted EXE SHA-256 approval in protected CI.
$sqliteVer = '3530400'
$sqliteUrl = "https://www.sqlite.org/2026/sqlite-tools-win-x64-$sqliteVer.zip"
$stageSqlite = Join-Path $Stage 'sqlite3.exe'
$sqliteTempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$sqliteWork = Join-Path $sqliteTempRoot ('n54-sqlite-'+[guid]::NewGuid().ToString('N'))
$sqliteZip = Join-Path $sqliteWork 'sqlite-tools.zip'
$extractDir = Join-Path $sqliteWork 'extracted'
$null = [IO.Directory]::CreateDirectory($sqliteWork)
try {
    Write-Host "Downloading sqlite3.exe for diagnostic or explicitly approved MSI ($sqliteVer)"
    # Never reuse a previous mutable TEMP download as approved release bytes.
    Invoke-WebRequest -Uri $sqliteUrl -OutFile $sqliteZip -UseBasicParsing
    $zipInfo = Get-Item -LiteralPath $sqliteZip -Force -ErrorAction Stop
    if ($zipInfo -isnot [IO.FileInfo] -or $zipInfo.Length -lt 1 -or
        $zipInfo.Length -gt 67108864 -or
        ($zipInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'N54 SQLite download type or size rejected.'
    }
    if ($releasePackage) {
        # MUST be checked before processing the ZIP archive, not against an
        # attacker-controlled hash adjacent to the downloaded artifact.
        $null = Assert-N54ApprovedSqliteFile -Path $sqliteZip -Kind Archive -ApprovedSha256 $env:SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED
    }
    Expand-Archive -LiteralPath $sqliteZip -DestinationPath $extractDir -Force
    $sqliteCandidates = @(Get-ChildItem -LiteralPath $extractDir -Recurse -File -Filter 'sqlite3.exe')
    if ($sqliteCandidates.Count -ne 1) {
        throw 'N54 SQLite official ZIP must contain exactly one sqlite3.exe.'
    }
    $sqliteExe = $sqliteCandidates[0]
    if ($sqliteExe.Length -lt 1 -or $sqliteExe.Length -gt 33554432 -or
        ($sqliteExe.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'N54 SQLite executable type or size rejected.'
    }
    if ($releasePackage) {
        $null = Assert-N54ApprovedSqliteFile -Path $sqliteExe.FullName -Kind Executable -ApprovedSha256 $env:SQLITE3_EXE_SHA256_APPROVED
    }
    Copy-Item -LiteralPath $sqliteExe.FullName -Destination $stageSqlite -Force
    if ($releasePackage) {
        # Check the exact bytes actually staged for WiX, not just the archive.
        $null = Assert-N54ApprovedSqliteFile -Path $stageSqlite -Kind Executable -ApprovedSha256 $env:SQLITE3_EXE_SHA256_APPROVED
    }
} finally {
    # No global cache of an approved ZIP; cleanup on both success and failure.
    if (Test-Path -LiteralPath $sqliteWork) {
        Remove-Item -LiteralPath $sqliteWork -Recurse -Force -ErrorAction SilentlyContinue
    }
}
if (-not (Test-Path -LiteralPath $stageSqlite -PathType Leaf)) {
    throw 'N54 sqlite3.exe staging failed.'
}
Write-Host "Staged sqlite3.exe ($($(Get-Item $stageSqlite).Length) bytes); production pin verified: $releasePackage"

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

# N62: verify exact installed WiX command version before invoking any
# packaging operation; never rely on a floating 5.* tool selection.
Import-Module -Name (Join-Path $RepoRoot 'Enterprise\agent\build\BuildToolchainLock.psm1') -Force -ErrorAction Stop
$null=Assert-N62InstalledWix
$wix = Get-Command wix -CommandType Application -ErrorAction Stop

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
