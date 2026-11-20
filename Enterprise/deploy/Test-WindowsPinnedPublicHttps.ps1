#Requires -Version 5.1
# Phase N42: optional, read-only operator-run HTTPS /healthz diagnostic.
# NOT installed or invoked by N31/N38 customer acceptance or the agent.
# NEVER runs live without the exact, per-invocation confirmation string.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ConfigPath,
    [Parameter(Mandatory=$true)][string]$ReportPath,
    [switch]$DryRun,
    [string]$ConfirmLive,
    [string]$ApprovedOrigin,
    [string]$ApprovedCurlSignerSha256
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Consent is checked before reading configuration, resolving DNS, invoking
# the OS curl binary, or writing a report. Invalid combinations fail closed.
if (($DryRun -and ($ConfirmLive -or $ApprovedOrigin -or $ApprovedCurlSignerSha256)) -or
    (-not $DryRun -and
      ($ConfirmLive -cne 'PROBE_PUBLIC_HEALTH' -or
       [string]::IsNullOrWhiteSpace($ApprovedOrigin) -or
       $ApprovedCurlSignerSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z'))) {
    throw 'Public Windows live probe requires origin-bound operator consent.'
}
if (Test-Path -LiteralPath $ReportPath) {
    throw 'Public Windows probe refuses to overwrite existing evidence.'
}

# The pinned transport module imports the N39 policy in its own scope.
# Re-import N39 last in this script scope so its exported endpoint admission
# is visible here even when Import-Module -Force updates module sessions.
Import-Module -Name (Join-Path $PSScriptRoot 'PublicWindowsPinnedTls.psm1') -Force -ErrorAction Stop
Import-Module -Name (Join-Path $PSScriptRoot 'PublicWindowsAddressPolicy.psm1') -Force -ErrorAction Stop
Import-Module -Name (Join-Path $PSScriptRoot 'ValidateWindowsHealthJson.psm1') -Force -ErrorAction Stop
Import-Module -Name (Join-Path $PSScriptRoot 'PrivateWindowsProbeWorkspace.psm1') -Force -ErrorAction Stop
Import-Module -Name (Join-Path $PSScriptRoot 'TrustedWindowsSystemCurl.psm1') -Force -ErrorAction Stop

$mode = if ($DryRun) { 'OFFLINE_DRY_RUN' } else { 'OPERATOR_CONFIRMED_LIVE' }
$state = 'BLOCKED'
$phase = 'LOAD_CONFIGURATION'
$workspace = $null
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
    $phase = 'VALIDATE_ENDPOINT'
    $endpoint = [string]$config.endpoint
    $origin = Test-PublicWindowsEndpointOrigin -Endpoint $endpoint
    # N43: an operator must explicitly type/approve the *canonical exact*
    # destination origin. A hostname change between offline approval and live
    # execution must fail before DNS or any network operation. Do not infer
    # consent from the mutable agent config or normalize the approved input.
    if (-not $DryRun -and $ApprovedOrigin -cne $origin) {
        throw 'Operator-approved HTTPS origin differs from configuration.'
    }
    if ($DryRun) {
        $phase = 'OFFLINE_DRY_RUN'
        # Dry run is a syntax check only; zero DNS/HTTP and no curl invocation.
        $state = 'PENDING'
    } else {
        $phase = 'LIVE_DNS'
        if ($env:OS -cne 'Windows_NT') { throw 'Windows host required.' }
        $dnsHost = $origin.Substring('https://'.Length)

        # N45: create and verify an ACL-protected response directory and an
        # exclusive ordinary response file BEFORE resolving DNS or running
        # curl. Never write privileged probe output into redirected %TEMP%.
        $phase = 'PRIVATE_WORKSPACE'
        $workspace = New-PrivateWindowsProbeWorkspace
        $responseFile = $workspace.ResponsePath
        # N48: check only the OS system32 signed curl and its compiled
        # Schannel backend BEFORE any customer DNS. -q --version cannot
        # contact a customer origin. Process trust overrides are removed
        # for BOTH provenance inspection and the later live GET, restored
        # in finally; no downgrade to PATH curl or non-Schannel is allowed.
        $phase = 'VALIDATE_CURL'
        foreach ($name in $clearEnv) {
            $originalEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        # N49 requires an independently approved exact leaf signing
        # certificate SHA-256, not an automatically inferred local pin.
        $phase = 'VALIDATE_SIGNER_PIN'
        $curl = Assert-PublicWindowsTrustedSystemCurl -ApprovedSignerSha256 $ApprovedCurlSignerSha256

        $phase = 'LIVE_DNS'
        # OS resolver's returned set must be entirely public. OS lookup is not
        # proof of every globally published A/AAAA record; --resolve pins one
        # vetted address and prevents a second lookup during connection.
        $ips = @([System.Net.Dns]::GetHostAddresses($dnsHost) |
            ForEach-Object { $_.ToString() })
        $curlArguments = @(New-PublicWindowsPinnedCurlArguments -Endpoint $endpoint -ResolvedAddressLiterals $ips -ResponsePath $responseFile)

        # Fixed HTTPS GET only; -q ignores user curlrc, --resolve pins checked
        # IP while HTTPS URL retains TLS hostname/SNI. No redirect or proxy.
        $phase = 'HTTPS_TRANSFER'
        $httpStatus = @(& $curl @curlArguments 2>$null)
        $transportExit = $LASTEXITCODE
        # N43 shares one offline-tested fail-closed outcome state machine
        # across native DNS/TLS/timeout, HTTP redirect/errors, size and JSON
        # failures. It checks file.Length *before* allocating/reading bytes.
        $phase = 'VALIDATE_HEALTH_RESULT'
        $null = Assert-PublicWindowsPinnedHealthResult -TransportExitCode $transportExit -StatusLines $httpStatus -ResponsePath $responseFile
        $state = 'PASS'
    }
} catch {
    # No untrusted JSON, DNS answer, endpoint, token, path or stderr leaks.
    $state = 'BLOCKED'
} finally {
    foreach ($name in $originalEnv.Keys) {
        [Environment]::SetEnvironmentVariable($name, $originalEnv[$name], 'Process')
    }
    if ($null -ne $workspace) {
        try {
            # N47: a healthy HTTPS response is never reported PASS when the
            # private response file could not be deleted. No silent cleanup,
            # and no unrestricted recursive delete of unknown files.
            $null = Remove-PrivateWindowsProbeWorkspace -Workspace $workspace
        } catch {
            $state = 'BLOCKED'
            $phase = 'PRIVATE_WORKSPACE_CLEANUP'
        }
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
    diagnostic_phase = if ($state -eq 'BLOCKED') { $phase } else { 'NONE' }
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
