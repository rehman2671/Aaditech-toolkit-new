# build-agent.ps1 - Compiles canonical Agent-Collect.ps1 into IT-Toolkit-Agent.exe via ps2exe.
# Produces Enterprise/agent/build/out/IT-Toolkit-Agent.exe and stages agent-config.json.
# Strictly requires authentic ps2exe compiler; zero fake stub or mock PE fallback.

[CmdletBinding()]
param(
    [string]$SourceScript = "$PSScriptRoot\..\Agent-Collect.ps1",
    [string]$ConfigFile = "$PSScriptRoot\..\agent-config.json",
    [string]$OutputDir = "$PSScriptRoot\out"
)

$ErrorActionPreference = 'Stop'

Write-Host "=== IT-Toolkit Agent Executable Compilation ==="

# 1. Require canonical agent source
if (-not (Test-Path -LiteralPath $SourceScript -PathType Leaf)) {
    throw "Canonical agent source script missing: $SourceScript"
}

# 2. Require real installed ps2exe compiler
$compiler = Get-Command ps2exe -ErrorAction SilentlyContinue
if (-not $compiler) {
    throw "ps2exe compiler command not found in PowerShell environment. Install via: Install-Module ps2exe -Force -Scope CurrentUser"
}

# 3. Read metadata from agent-version.json if available
$versionFile = Join-Path $PSScriptRoot '..\agent-version.json'
$agentVersion = '1.1.2'
if (Test-Path -LiteralPath $versionFile) {
    try {
        $meta = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json -AsHashtable
        if ($meta.agent_version) { $agentVersion = [string]$meta.agent_version }
    } catch {
        Write-Warning "Could not parse agent-version.json; using default $agentVersion"
    }
}

# 4. Prepare output directory
if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$outputExe = Join-Path $OutputDir 'IT-Toolkit-Agent.exe'
if (Test-Path -LiteralPath $outputExe) {
    Remove-Item -LiteralPath $outputExe -Force
}

# 5. Invoke real ps2exe compiler
Write-Host "Compiling $SourceScript -> $outputExe (Version: $agentVersion)..."

$compileParams = @{
    inputFile   = (Resolve-Path $SourceScript).Path
    outputFile  = $outputExe
    noConsole   = $false
    runtime40   = $true
    title       = "IT-Toolkit Enterprise Agent"
    description = "Enterprise IT Endpoint Administration & Monitoring Agent"
    company     = "Aaditech"
    product     = "IT-Toolkit Enterprise"
    version     = $agentVersion
    copyright   = "(c) 2026 Aaditech. All rights reserved."
}

& ps2exe @compileParams
if ($LASTEXITCODE -ne 0) {
    throw "ps2exe compiler exited with error code $LASTEXITCODE"
}

# 6. Verify compiled binary
if (-not (Test-Path -LiteralPath $outputExe -PathType Leaf)) {
    throw "Compilation failure: Output binary $outputExe was not created."
}

$exeSize = (Get-Item -LiteralPath $outputExe).Length
if ($exeSize -le 10240) { # Authentic ps2exe output is at least 30KB+ (.NET payload)
    throw "Compilation failure: Output binary $outputExe is too small ($exeSize bytes); suspected corrupted or non-functional executable."
}

Write-Host "Successfully compiled authentic agent executable: $outputExe ($exeSize bytes)"

# 7. Stage agent-config.json into output directory for WiX installer consumption
$targetConfig = Join-Path $OutputDir 'agent-config.json'
if (Test-Path -LiteralPath $ConfigFile) {
    Copy-Item -LiteralPath $ConfigFile -Destination $targetConfig -Force
    Write-Host "Staged agent-config.json to $targetConfig"
} else {
    Write-Warning "Source agent config $ConfigFile not found; staging placeholder agent-config.json"
    @{
        endpoint = "https://localhost:3000/api/v1/ingest/telemetry"
        agent_version = $agentVersion
        interval_minutes = 30
    } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $targetConfig
}

Write-Host "=== Agent Build Step Completed Successfully ==="
