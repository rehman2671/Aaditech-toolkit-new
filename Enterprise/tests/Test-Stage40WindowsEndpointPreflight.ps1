#Requires -Version 5.1
# N40: deterministic, offline endpoint-shape and redacted preflight tests.
# No customer endpoint is resolved or contacted.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$modulePath = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\PublicWindowsAddressPolicy.psm1'))
$acceptance = Join-Path $PSScriptRoot 'Test-CustomerWindowsAcceptance.ps1'
Import-Module -Name $modulePath -Force -ErrorAction Stop

$telemetry = '/api/v1/ingest/telemetry'
$goodHost = 'fleet.syntheticvendor.tld'
$ok = Test-PublicWindowsEndpointOrigin -Endpoint ("https://$goodHost" + $telemetry)
if ($ok -cne "https://$goodHost") { throw 'Expected normalized public HTTPS origin.' }
$ok = Test-PublicWindowsEndpointOrigin -Endpoint ("HTTPS://FLEET.SYNTHETICVENDOR.TLD:443" + $telemetry)
if ($ok -cne "https://$goodHost") { throw 'Hostname case/default TLS port normalization failed.' }

$badUrls = @(
    "http://$goodHost$telemetry",
    "https://localhost$telemetry",
    "https://127.0.0.1$telemetry",
    "https://[::1]$telemetry",
    "https://169.254.169.254$telemetry",
    "https://metadata.google.internal$telemetry",
    "https://service.example.net$telemetry",
    "https://user:pass@$goodHost$telemetry",
    "https://$($goodHost):8443$telemetry",
    "https://$goodHost${telemetry}?token=synthetic",
    "https://$goodHost${telemetry}#fragment",
    "https://$goodHost$telemetry/",
    "https://$goodHost/api/v1/ingest/%74elemetry",
    "https://$goodHost/other/path",
    "https://$goodHost./api/v1/ingest/telemetry",
    "https://$goodHost$telemetry" + [char]10,
    " https://$goodHost$telemetry"
)
for ($fixtureIndex = 0; $fixtureIndex -lt $badUrls.Count; $fixtureIndex++) {
    $url = $badUrls[$fixtureIndex]
    $rejected = $false
    try {
        $null = Test-PublicWindowsEndpointOrigin -Endpoint $url -ErrorAction Stop
    } catch {
        $rejected = $true
        if ([string]$_.Exception.Message -cne 'Public HTTPS endpoint policy blocked.') {
            throw 'Denied endpoint exposed untrusted URL details.'
        }
    }
    if (-not $rejected) { throw "Unsafe endpoint admitted at offline fixture index $fixtureIndex." }
}

# Integration: N31 preflight must use the same gate. Other missing customer
# assets cause process exit 1 as expected; never allow any production claim.
$cases = @(
    @{name='valid-offline'; endpoint=("https://$goodHost$telemetry"); setup='PASS'},
    @{name='private-host'; endpoint=("https://127.0.0.1$telemetry"); setup='BLOCKED'},
    @{name='reserved-host'; endpoint=("https://service.example.net$telemetry"); setup='BLOCKED'},
    @{name='userinfo'; endpoint=("https://x:y@$goodHost$telemetry"); setup='BLOCKED'},
    @{name='alternate-port'; endpoint=("https://$($goodHost):8443$telemetry"); setup='BLOCKED'}
)
$dir = Join-Path ([IO.Path]::GetTempPath()) ('n40-endpoint-' + [guid]::NewGuid().ToString('N'))
New-Item -Path $dir -ItemType Directory -Force | Out-Null
try {
    foreach ($case in $cases) {
        $config = Join-Path $dir ($case.name + '-agent.json')
        $report = Join-Path $dir ($case.name + '-report.json')
        $secret = 'N40-SYNTHETIC-SECRET-DO-NOT-PRINT'
        @{ endpoint=$case.endpoint; token=$secret; needs_setup=$false } |
            ConvertTo-Json | Set-Content -LiteralPath $config -Encoding utf8
        $args = @('-NoProfile', '-NonInteractive', '-File', $acceptance,
            '-ReportPath', $report, '-InstallRoot', $dir,
            '-ConfigPath', $config, '-QueueDb', (Join-Path $dir 'queue.sqlite3'))
        $output = @(& pwsh @args 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 1) { throw 'Synthetic customer preflight unexpectedly completed successfully.' }
        $raw = [IO.File]::ReadAllText($report)
        $result = $raw | ConvertFrom-Json -ErrorAction Stop
        $setup = @($result.checks | Where-Object { $_.id -eq 'setup' })
        $network = @($result.checks | Where-Object { $_.id -eq 'public_https' })
        if ($setup.Count -ne 1 -or $setup[0].state -cne $case.setup) {
            throw ('Offline setup decision wrong for case: ' + $case.name)
        }
        if ($network.Count -ne 1 -or $network[0].state -cne 'PENDING' -or
            $result.certified_for_production -ne $false -or $result.decision -cne 'BLOCKED') {
            throw ('Synthetic case changed live/production safety contract: ' + $case.name)
        }
        $combined = $raw + ($output -join '')
        if ($combined.Contains($secret) -or $combined.Contains($case.endpoint)) {
            throw 'Preflight report/stdout leaked the configured endpoint or secret.'
        }
    }
    Write-Host 'N40 PASS: strict offline HTTPS endpoint origins, preflight integration, redaction and no live probing.'
} finally {
    Remove-Item -LiteralPath $dir -Force -Recurse -ErrorAction SilentlyContinue
}
