# Exercise the real isolated worker self-update function on Windows.
# Any MSI download, task escalation or msiexec call must fail this test.
$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot '..\agent\Agent-Collect.ps1'
$tok = $null; $errs = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tok, [ref]$errs)
if ($errs.Count -gt 0) { throw "Agent source PowerShell parse errors: $($errs | Out-String)" }
$found = @($ast.FindAll({
    param($x) $x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq 'Update-AgentIfNeeded'
}, $true))
if ($found.Count -ne 1) { throw 'Expected one installed worker self-update entry' }
Invoke-Expression $found[0].Extent.Text
function Write-AgentLog { param([string]$Message) $script:LogMessage = $Message }
function Invoke-WebRequest { throw 'SECURITY: unsigned MSI download attempted' }
function Start-Process { throw 'SECURITY: unsigned MSI install attempted' }
function Request-ElevatedJob { throw 'SECURITY: unsigned MSI delegated to SYSTEM' }
$result = Update-AgentIfNeeded -Config ([pscustomobject]@{ endpoint='https://ci.example.test' })
if ($result -ne $false -or $script:LogMessage -notmatch 'AUTO_UPDATE_RELEASE_APPROVAL_REQUIRED') {
    throw 'Worker reported auto-update success without a verified signed release'
}
$source = Get-Content -LiteralPath $path -Raw
if ($source -match '(?i)Start-Process\s+msiexec|Invoke-WebRequest|IT-Toolkit-Agent-update\.msi') {
    throw 'Worker still contains an unverified installer execution/download path'
}
Write-Host '[PASS] Automatic MSI self-update blocks unsigned download and execution.'
