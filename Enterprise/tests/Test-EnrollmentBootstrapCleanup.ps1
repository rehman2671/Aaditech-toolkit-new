# Validate the installed worker's token-clearing function without launching it.
# A consumed bootstrap secret must not survive alongside the enrolled token.
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\agent\Agent-Collect.ps1'
$parseTokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw "Agent parse errors: $($parseErrors | Out-String)" }
$functions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Clear-EnrollmentBootstrapToken'
}, $true))
if ($functions.Count -ne 1) { throw 'Expected one bootstrap credential cleanup function' }
Invoke-Expression $functions[0].Extent.Text

$sourceText = Get-Content $source -Raw
$stored = $sourceText.IndexOf('[IO.File]::WriteAllText($tokenPath')
$cleared = $sourceText.IndexOf('Clear-EnrollmentBootstrapToken -Config $Config')
if ($stored -lt 0 -or $cleared -le $stored) {
    throw 'Enrollment must save device credential before clearing its bootstrap token'
}

$dir = Join-Path ([IO.Path]::GetTempPath()) ("itk-bootstrap-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$script:ConfigPath = Join-Path $dir 'agent.json'
try {
    $cfg = [PSCustomObject]@{
        endpoint = 'https://enrolled.example.test/api/v1/ingest/telemetry'
        enroll_url = 'https://enrolled.example.test/api/v1/agent/enroll'
        token = 'one-use-ci-bootstrap-token'
        interval_minutes = 30
        needs_setup = $false
        run_script_allowlist = @('Scripts/Allowed.ps1')
    }
    $cfg | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
    Clear-EnrollmentBootstrapToken -Config $cfg
    $saved = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
    if ($saved.token -ne '' -or $cfg.token -ne '') { throw 'Bootstrap token survived successful device enrollment' }
    if ($saved.endpoint -ne 'https://enrolled.example.test/api/v1/ingest/telemetry' -or
        $saved.needs_setup -ne $false -or
        $saved.run_script_allowlist[0] -ne 'Scripts/Allowed.ps1') {
        throw 'Bootstrap cleanup corrupted unrelated agent settings'
    }
    # Windows filename glob 'agent.json.*' can also match the original
    # 'agent.json' because DOS wildcards treat the trailing .* specially.
    # Only the sensitive temporary/backup filenames count as leftovers.
    $orphans = @(Get-ChildItem -LiteralPath $dir -File | Where-Object {
        $_.Name -like 'agent.json.tmp.*' -or
        $_.Name -like 'agent.json.backup.*'
    })
    if ($orphans.Count -ne 0) {
        throw "Bootstrap cleanup left sensitive files behind: $($orphans.Name -join ', ')"
    }
    Clear-EnrollmentBootstrapToken -Config $cfg
    $saved = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
    if ($saved.token -ne '') { throw 'Bootstrap cleanup is not idempotent' }

    Remove-Item -LiteralPath $script:ConfigPath -Force
    $failedClosed = $false
    try { Clear-EnrollmentBootstrapToken -Config $cfg }
    catch { $failedClosed = $true }
    if (-not $failedClosed) { throw 'Missing configuration must fail closed instead of claiming token cleanup' }

    Write-Host 'Enrollment bootstrap secret cleanup tests passed.'
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
