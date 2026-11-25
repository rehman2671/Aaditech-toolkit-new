# Windows-only smoke: parse installed worker, isolate one command dispatcher,
# and verify a signed reboot cannot cause a reboot or be reported as completed.
$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot '..\agent\Agent-Collect.ps1'
$tokens=$null; $errors=$null
$ast = [Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
if($errors.Count -gt 0) { throw "Worker parser error: $($errors | Out-String)" }
$functions=@($ast.FindAll({
    param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-RemoteCommand'
},$true))
if($functions.Count -ne 1) { throw 'Expected exactly one installed worker command dispatcher' }
Invoke-Expression $functions[0].Extent.Text
function Request-ElevatedJob { throw 'SECURITY: reboot delegated to SYSTEM' }
foreach($delay in @(-1,0,60)) {
    $output=Invoke-RemoteCommand -Config @{} -Cmd ([pscustomobject]@{
        kind='reboot'; payload=[pscustomobject]@{delay_seconds=$delay}
    })
    if($output.status -ne 'failed' -or $output.exit_code -ne 403 -or
        $output.output -notmatch 'REBOOT_APPROVAL_REQUIRED') {
        throw "Unapproved reboot was not blocked: $($output | Out-String)"
    }
}
$raw=Get-Content -LiteralPath $path -Raw
if($raw -match '(?i)Restart-Computer|shutdown\.exe') {
    throw 'Worker still has automatic OS reboot primitives'
}
Write-Host '[PASS] Unapproved signed reboot is refused; no SYSTEM request or false completion.'

# The actual worker entry point must refuse legacy elevation before even
# looking for a configuration or importing modules.
$workerShell=(Get-Process -Id $PID).Path
$output=& $workerShell -NoProfile -File $path -ElevatedOnce -ConfigPath 'Z:\missing-itk-config.json' 2>&1
if ($LASTEXITCODE -ne 3 -or ($output -join ' ') -notmatch 'LEGACY_ELEVATED_WORKER_DISABLED') {
    throw 'Legacy elevated entry point was not refused before configuration'
}
$delegate=@($ast.FindAll({
    param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Request-ElevatedJob'
},$true))
if($delegate.Count -ne 1) {throw 'Expected deny-only compatibility function'}
Invoke-Expression $delegate[0].Extent.Text
if ((Request-ElevatedJob -Action 'update') -ne $false) {throw 'Legacy privileged delegation accepted'}
Write-Host '[PASS] Legacy elevated entry point and delegation are blocked.'
