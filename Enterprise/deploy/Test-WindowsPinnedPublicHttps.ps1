#Requires -Version 5.1
# Phase N42: optional, read-only operator-run HTTPS /healthz diagnostic.
# NOT installed or invoked by N31/N38 customer acceptance or the agent.
# NEVER runs live without the exact, per-invocation confirmation string.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ConfigPath,
    [Parameter(Mandatory=$true)][string]$ReportPath,
    [switch]$DryRun,
    [string]$ConfirmLive
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Consent is checked before reading configuration, resolving DNS, invoking
# the OS curl binary, or writing a report. Invalid combinations fail closed.
if (($DryRun -and $ConfirmLive) -or
    (-not $DryRun -and $ConfirmLive -cne 'PROBE_PUBLIC_HEALTH')) {
    throw 'Public Windows live probe requires explicit operator consent.'
}
if (Test-Path -LiteralPath $ReportPath) {
    throw 'Public Windows probe refuses to overwrite existing evidence.'
}

Import-Module -Name (Join-Path $PSScriptRoot 'PublicWindowsAddressPolicy.psm1') -Force -ErrorAction Stop
Import-Module -Name (Join-Path $PSScriptRoot 'PublicWindowsPinnedTls.psm1') -Force -ErrorAction Stop
Import-Module -Name (Join-Path $PSScriptRoot 'ValidateWindowsHealthJson.psm1') -Force -ErrorAction Stop

$mode = if ($DryRun) { 'OFFLINE_DRY_RUN' } else { 'OPERATOR_CONFIRMED_LIVE' }
$state = 'BLOCKED'
$temporaryDirectory = $null
$originalEnv = @{}
$clearEnv = @(
    'CURL_CA_BUNDLE', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
    'CURL_SSL_BACKEND', 'CURL_HOME', 'SSLKEYLOGFILE',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'CURL_PROXY'
)
try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw -ErrorAction Stop |
        ConvertFrom-Json -ErrorAction Stop
    if ($config.needs_setup -ne $false) { throw 'Agent setup is incomplete.' }
    $endpoint = [string]$config.endpoint
    $origin = Test-PublicWindowsEndpointOrigin -Endpoint $endpoint
    if ($DryRun) {
        # Dry run is a syntax check only; zero DNS/HTTP and no curl invocation.
        $state = 'PENDING'
    } else {
        if ($env:OS -cne 'Windows_NT') { throw 'Windows host required.' }
        $dnsHost = $origin.Substring('https://'.Length)

        # OS resolver's returned set must be entirely public. OS lookup is not
        # proof of every globally published A/AAAA record; --resolve pins one
        # vetted address and prevents a second lookup during connection.
        $ips = @([System.Net.Dns]::GetHostAddresses($dnsHost) |
            ForEach-Object { $_.ToString() })
        $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) (
            'aaditech-n42-' + [guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
        $responseFile = Join-Path $temporaryDirectory 'response.json'
        $curlArguments = @(New-PublicWindowsPinnedCurlArguments -Endpoint $endpoint -ResolvedAddressLiterals $ips -ResponsePath $responseFile)

        # Only use OS-owned curl. Fake curl.exe earlier in PATH must never
        # intercept customer traffic or replace hostname TLS verification.
        $curl = Join-Path ([Environment]::SystemDirectory) 'curl.exe'
        if (-not (Test-Path -LiteralPath $curl -PathType Leaf)) {
            throw 'Trusted Windows curl unavailable.'
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $curl
        if ($signature.Status -ne 'Valid' -or
            $null -eq $signature.SignerCertificate -or
            $signature.SignerCertificate.Subject -notmatch '(?i)O=Microsoft Corporation') {
            throw 'Windows curl vendor signature not verified.'
        }

        # Clear user CA/backend/proxy/key-log overrides for BOTH version check
        # and live request; restore process values afterward.
        foreach ($name in $clearEnv) {
            $originalEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        # Require Schannel native root trust, not arbitrary curl build/config.
        # System CA trust is NOT independent public-CA custody evidence.
        $version = @(& $curl -q --version 2>$null)
        if ($LASTEXITCODE -ne 0 -or
            @($version | Where-Object { $_ -match 'Schannel' }).Count -lt 1) {
            throw 'Windows curl system TLS backend not verified.'
        }

        # Fixed HTTPS GET only; -q ignores user curlrc, --resolve pins checked
        # IP while HTTPS URL retains TLS hostname/SNI. No redirect or proxy.
        $httpStatus = @(& $curl @curlArguments 2>$null)
        if ($LASTEXITCODE -ne 0 -or
            $httpStatus.Count -ne 1 -or [string]$httpStatus[0] -cne '200' -or
            -not (Test-Path -LiteralPath $responseFile -PathType Leaf)) {
            throw 'Pinned HTTPS transport refused.'
        }
        $responseBytes = [IO.File]::ReadAllBytes($responseFile)
        # curl --max-filesize is not a substitute for an explicit byte bound.
        if ($responseBytes.Length -eq 0 -or $responseBytes.Length -gt 65536) {
            throw 'Health response size refused.'
        }
        $null = Assert-PublicWindowsHealthJson -JsonUtf8 $responseBytes
        $state = 'PASS'
    }
} catch {
    # No untrusted JSON, DNS answer, endpoint, token, path or stderr leaks.
    $state = 'BLOCKED'
} finally {
    foreach ($name in $originalEnv.Keys) {
        [Environment]::SetEnvironmentVariable($name, $originalEnv[$name], 'Process')
    }
    if ($null -ne $temporaryDirectory -and
        (Test-Path -LiteralPath $temporaryDirectory)) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Immutable redacted diagnostic. PASS means one healthy HTTPS GET using
# local OS trust, NOT production certification or public DNS ownership proof.
$parent = Split-Path -Parent $ReportPath
if ($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw 'Public Windows report parent directory does not exist.'
}
$report = [pscustomobject]@{
    schema = 'aaditech-stage42-windows-https-v1'
    timestamp_utc = [DateTime]::UtcNow.ToString('o')
    mode = $mode
    https_health_probe = $state
    certified_for_production = $false
    physical_lost_ack = 'PENDING'
    public_publisher_signed_msi = 'PENDING'
    external_hostinger_acceptance = 'PENDING'
    independent_security_review = 'PENDING'
}
$json = $report | ConvertTo-Json -Depth 5
$bytes = [Text.UTF8Encoding]::new($false).GetBytes($json + [Environment]::NewLine)
$stream = [IO.File]::Open($ReportPath, [IO.FileMode]::CreateNew,
    [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
} finally {
    $stream.Dispose()
}
Write-Host "N42 Windows HTTPS diagnostic: $state. Production certification remains PENDING."
if ($state -eq 'BLOCKED') { exit 1 }
exit 0
