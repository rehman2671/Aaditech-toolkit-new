# N38 offline/zero-network Windows acceptance regression. Must run under pwsh
# on an isolated CI runner. No actual customer host is contacted.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path $PSScriptRoot 'Test-CustomerWindowsAcceptance.ps1'
$rawSource = [IO.File]::ReadAllText($source)

# This is deliberately a fail-closed mitigation, not a mock certificate
# validation: the separate N38 pinned Windows transport is not built yet.
foreach ($unsafeApi in @(
    'Invoke-RestMethod', 'Invoke-WebRequest', 'System.Net.HttpClient',
    'System.Net.WebRequest', 'System.Net.Sockets.TcpClient',
    'GetHostAddresses', 'curl.exe'
)) {
    if ($rawSource.IndexOf($unsafeApi, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Unsafe direct Windows live transport reintroduced: $unsafeApi"
    }
}

$dir = Join-Path ([IO.Path]::GetTempPath()) ('n38-offline-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir -Force | Out-Null
try {
    $secret = 'N38-UNPUBLISHED-TOKEN-MUST-NOT-LEAK'
    $configPath = Join-Path $dir 'agent.json'
    # Even a configured-looking HTTPS endpoint may be DNS-rebound: never call
    # it from the unpinned Windows path. This is a synthetic, reserved name.
    @{ endpoint='https://console.example.net/api/v1/ingest/telemetry'
       needs_setup=$false; token=$secret } |
      ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8

    foreach ($scenario in @('default', 'requested-live')) {
        $reportPath = Join-Path $dir "$scenario.json"
        $args = @('-NoProfile','-NonInteractive','-File',$source,
                  '-ReportPath',$reportPath,'-InstallRoot',$dir,
                  '-ConfigPath',$configPath,'-QueueDb',(Join-Path $dir 'queue.sqlite3'))
        if ($scenario -eq 'requested-live') { $args += '-NetworkProbe' }
        $output = @(& pwsh @args 2>&1 | Out-String)
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 1) { throw "Scenario $scenario should remain BLOCKED due to absent customer fixtures" }
        if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
            throw "Missing exclusive redacted report for $scenario"
        }
        $raw = Get-Content -LiteralPath $reportPath -Raw
        $report = $raw | ConvertFrom-Json -ErrorAction Stop
        $public = @($report.checks | Where-Object { $_.id -eq 'public_https' })
        $expected = if ($scenario -eq 'requested-live') { 'BLOCKED' } else { 'PENDING' }
        if ($public.Count -ne 1 -or $public[0].state -cne $expected) {
            throw "Scenario $scenario expected public_https=$expected"
        }
        if ($report.certified_for_production -ne $false -or $report.decision -cne 'BLOCKED') {
            throw "Scenario $scenario incorrectly certified a customer device"
        }
        $combined = $raw + [string]$output
        if ($combined.Contains($secret) -or $combined.Contains('console.example.net')) {
            throw "Secret or endpoint leaked in $scenario evidence"
        }
        if ($scenario -eq 'requested-live' -and
            $public[0].note -notmatch 'disabled') {
            throw "Requested live probe did not explain the safety block"
        }
    }
    Write-Host 'N38 PASS: Windows probe cannot contact DNS/HTTPS; requested live is explicitly blocked.'
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
