# Native Windows 7.x smoke: inventory-only child process must preserve the
# effective and scoped execution policies. Never run the installer branch.
$ErrorActionPreference = 'Stop'
$original = @(Get-ExecutionPolicy -List | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" })
$script = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/Install-Prereqs.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'Prerequisite script missing' }
$binary = (Get-Process -Id $PID).Path
$quotedScript = '"' + $script + '"'
$process = Start-Process -FilePath $binary -ArgumentList @('-NoProfile', '-File', $quotedScript, '-VerifyOnly', '-SkipDocker') -NoNewWindow -Wait -PassThru
if ($process.ExitCode -notin @(0, 3)) { throw "Read-only prerequisite inventory returned unexpected $($process.ExitCode)" }
$current = @(Get-ExecutionPolicy -List | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" })
if (($original -join '|') -ne ($current -join '|')) { throw 'Read-only inventory modified PowerShell execution policy' }
Write-Host '[PASS] Windows prerequisite inventory was read-only and preserved execution policy.'
