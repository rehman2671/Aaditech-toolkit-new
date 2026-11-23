# Native Windows parser/source proof. Never executes the agent loop.
$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot '..\agent\Aaditech-Agent.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw "Standalone agent PowerShell syntax errors: $($errors | Out-String)" }
$fnNames = @($ast.FindAll({
    param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]
}, $true) | ForEach-Object Name)
foreach ($name in @('Poll-And-Execute-Commands', 'Verify-CommandSignature', 'Invoke-RemoteCommand')) {
    if ($fnNames -contains $name) { throw "Unsafe legacy executor still present: $name" }
}
$raw = Get-Content -LiteralPath $path -Raw
foreach ($pattern in @('(?i)/api/commands/poll', '(?i)Restart-Service\b',
    '(?i)Remove-Item\s+"?\$env:TEMP', '(?i)switch\s+-Regex\s+\(\$cmd.kind',
    '(?i)Invoke-Expression\b', '(?i)Poll-And-Execute-Commands\s*$')) {
    if ($raw -match $pattern) { throw "Unsafe legacy command pattern: $pattern" }
}
if ($raw -notmatch 'TELEMETRY-ONLY' -or $raw -notmatch 'Send-TelemetryPayload') {
    throw 'Legacy collector must remain clearly telemetry-only'
}
Write-Host '[PASS] Standalone legacy agent is telemetry-only, no remote command executor.'
