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
