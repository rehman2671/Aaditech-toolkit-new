# Runs in Windows CI only; a retired installer must not mutate the OS.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'agent\install-agent.cmd'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'Legacy CMD path missing' }
$content = Get-Content -LiteralPath $script -Raw
if ($content -match '(?i)schtasks\s+/(?:create|delete|change)' -or
    $content -match '(?i)-ExecutionPolicy\s+Bypass' -or
    $content -match '(?i)\b(?:copy|xcopy|reg\s+add|msiexec|powershell\.exe)\b') {
    throw 'Retired agent CMD contains privileged installer or scheduled-task actions'
}
# Use cmd.exe with no administrator rights; should refuse before doing anything.
& $env:ComSpec /d /c ('"' + $script + '"') | Out-Null
if ($LASTEXITCODE -ne 3) { throw "Retired installer returned $LASTEXITCODE instead of blocked exit 3" }
Write-Host '[PASS] Legacy unchecked Windows SYSTEM agent installer is retired and does not execute.'
