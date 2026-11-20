#Requires -Version 5.1
# N43: deterministic OFFLINE native HTTPS-outcome fault injection. Deliberately
# NEVER invokes live with a correctly approved hostname; no DNS, HTTP or TLS.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$moduleFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\deploy\PublicWindowsPinnedTls.psm1'))
$probeFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
Import-Module -Name $moduleFile -Force -ErrorAction Stop

$root = Join-Path ([IO.Path]::GetTempPath()) ('aaditech-n43-offline-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
try {
    $health = '{"status":"ok","components":{"database":"HEALTHY"}}'
    $bytes = [Text.UTF8Encoding]::new($false, $true).GetBytes($health)
    $response = Join-Path $root 'response.json'
    [IO.File]::WriteAllBytes($response, $bytes)
    if ((Assert-PublicWindowsPinnedHealthResult -TransportExitCode 0 -StatusLines @('200') -ResponsePath $response) -ne $true) {
        throw 'Healthy fixture was not accepted by offline transfer validator.'
    }

    function Assert-TransferRefused {
        param([int]$ExitCode,[string[]]$Status,[string]$Path,[string]$Reason)
        $refused = $false
        try {
            $null = Assert-PublicWindowsPinnedHealthResult -TransportExitCode $ExitCode -StatusLines $Status -ResponsePath $Path
        } catch {
            $refused = $true
            if ($_.Exception.Message -cne 'Public Windows pinned HTTPS health result blocked.') {
                throw 'N43 negative transfer exposed path/body/transport details.'
            }
        }
        if (-not $refused) { throw "N43 admitted a synthetic fault: $Reason." }
    }

    # A malicious intermediary may return a valid health JSON body with
    # HTTP redirects/error status, or curl may produce a success-like "200"
    # despite nonzero DNS, timeout, trust or handshake exit. All must fail.
    $faults = @(
        @{ code=6; status=@('000'); reason='DNS resolve failure' },
        @{ code=7; status=@('200'); reason='connect failure despite HTTP-looking status' },
        @{ code=28; status=@('200'); reason='timeout' },
        @{ code=35; status=@('200'); reason='TLS handshake error' },
        @{ code=51; status=@('200'); reason='certificate verification error' },
        @{ code=52; status=@('200'); reason='empty server reply' },
        @{ code=60; status=@('200'); reason='certificate chain failure' },
        @{ code=63; status=@('200'); reason='curl oversized transfer' },
        @{ code=22; status=@('200'); reason='native HTTP abort' },
        @{ code=0; status=@('000'); reason='no HTTP status' },
        @{ code=0; status=@('301'); reason='permanent redirect' },
        @{ code=0; status=@('302'); reason='temporary redirect' },
        @{ code=0; status=@('303'); reason='redirect GET to alternative URL' },
        @{ code=0; status=@('307'); reason='temporary method-preserving redirect' },
        @{ code=0; status=@('308'); reason='permanent method-preserving redirect' },
        @{ code=0; status=@('401'); reason='authentication challenge' },
        @{ code=0; status=@('403'); reason='access denied' },
        @{ code=0; status=@('404'); reason='not found' },
        @{ code=0; status=@('429'); reason='rate limited' },
        @{ code=0; status=@('500'); reason='database/backend error' },
        @{ code=0; status=@('503'); reason='service unavailable' },
        @{ code=0; status=@('200','200'); reason='multiple HTTP status lines' },
        @{ code=0; status=@('200 '); reason='HTTP status trailing whitespace' },
        @{ code=0; status=@(' 200'); reason='HTTP status leading whitespace' },
        @{ code=0; status=@(); reason='empty curl status output' },
        @{ code=0; status=@('200', '302'); reason='extra status / chained response' }
    )
    foreach ($f in $faults) {
        Assert-TransferRefused -ExitCode $f.code -Status $f.status -Path $response -Reason $f.reason
    }

    $missing = Join-Path $root 'no-response.json'
    Assert-TransferRefused -ExitCode 0 -Status @('200') -Path $missing -Reason 'curl wrote no response body'
    Assert-TransferRefused -ExitCode 0 -Status @('200') -Path $root -Reason 'response points to directory'
    [IO.File]::WriteAllBytes($response, [byte[]]::new(0))
    Assert-TransferRefused -ExitCode 0 -Status @('200') -Path $response -Reason 'empty response file'
    [IO.File]::WriteAllBytes($response, [byte[]]::new(65537))
    Assert-TransferRefused -ExitCode 0 -Status @('200') -Path $response -Reason 'oversized response before allocation'

    $badJson = @(
        '{"status":"degraded","components":{"database":"HEALTHY"}}',
        '{"status":"ok","components":{"database":"DOWN"}}',
        '{"status":"ok","status":"ok","components":{"database":"HEALTHY"}}',
        '{"status":"ok","components":{"database":"HEALTHY","database":"HEALTHY"}}',
        '{"status":"ok","components":{"database":"HEALTHY"}}garbage',
        '<html>fake status ok</html>',
        '[]',
        '{"status":"ok","components":[]}'
    )
    foreach ($body in $badJson) {
        [IO.File]::WriteAllBytes($response, [Text.UTF8Encoding]::new($false).GetBytes($body))
        Assert-TransferRefused -ExitCode 0 -Status @('200') -Path $response -Reason 'forged/malformed health JSON'
    }
    [IO.File]::WriteAllBytes($response, [byte[]]@(0xef,0xbb,0xbf,0x7b,0x7d))
    Assert-TransferRefused -ExitCode 0 -Status @('200') -Path $response -Reason 'BOM forbidden'
    [IO.File]::WriteAllBytes($response, [byte[]]@(0x7b,0xff,0x7d))
    Assert-TransferRefused -ExitCode 0 -Status @('200') -Path $response -Reason 'invalid UTF-8'
    # At most 64 KiB is valid if the extra bytes are only JSON whitespace.
    [IO.File]::WriteAllBytes($response, [Text.UTF8Encoding]::new($false).GetBytes($health.PadRight(65536, ' ')))
    if ((Assert-PublicWindowsPinnedHealthResult -TransportExitCode 0 -StatusLines @('200') -ResponsePath $response) -ne $true) {
        throw 'Exact-size 64 KiB bounded healthy response was not accepted.'
    }

    # Consent is bound to the precise canonical hostname, not only the generic
    # confirmation token. Test only REFUSED live variants (so no DNS can run).
    $source = [IO.File]::ReadAllText($probeFile)
    $originCheck = 'if (-not $DryRun -and $ApprovedOrigin -cne $origin)'
    $dnsResolve = '[System.Net.Dns]::GetHostAddresses'
    if ($source.IndexOf($originCheck, [StringComparison]::Ordinal) -lt 0 -or
        $source.IndexOf($dnsResolve, [StringComparison]::Ordinal) -le $source.IndexOf($originCheck, [StringComparison]::Ordinal)) {
        throw 'N43 approved-origin equality guard must precede DNS.'
    }
    $hostname = 'fleet.syntheticvendor.tld'
    $origin = 'https://' + $hostname
    $secret = 'N43-SYNTHETIC-CREDENTIAL-DO-NOT-DISCLOSE'
    $config = Join-Path $root 'agent.json'
    @{ needs_setup=$false; endpoint=($origin+'/api/v1/ingest/telemetry'); token=$secret } |
        ConvertTo-Json | Set-Content -LiteralPath $config -Encoding utf8
    $runner = if ($PSVersionTable.PSVersion.Major -le 5) { 'powershell.exe' } else { 'pwsh.exe' }

    function Invoke-N43Child {
        param([string[]]$Arguments)
        $prior = $ErrorActionPreference
        try {
            # Native expected-error stderr is a NativeCommandError in PS5.1.
            $ErrorActionPreference = 'Continue'
            $output = @(& $runner @Arguments 2>&1 | Out-String)
            $status = $LASTEXITCODE
        } finally { $ErrorActionPreference = $prior }
        return [pscustomobject]@{exit=$status;output=($output -join '')}
    }

    $badConsent = @(
        @{ name='no-consent'; extra=@(); report=$false },
        @{ name='no-approved-origin';extra=@('-ConfirmLive','PROBE_PUBLIC_HEALTH');report=$false },
        @{ name='no-live-token';extra=@('-ApprovedOrigin',$origin);report=$false },
        @{ name='invalid-live-token';extra=@('-ConfirmLive','WRONG','-ApprovedOrigin',$origin);report=$false },
        @{ name='dry-run-with-origin';extra=@('-DryRun','-ApprovedOrigin',$origin);report=$false },
        @{ name='dry-run-with-token';extra=@('-DryRun','-ConfirmLive','PROBE_PUBLIC_HEALTH');report=$false },
        @{ name='wrong-host';extra=@('-ConfirmLive','PROBE_PUBLIC_HEALTH','-ApprovedOrigin','https://different.syntheticvendor.tld');report=$true },
        @{ name='uppercase-host';extra=@('-ConfirmLive','PROBE_PUBLIC_HEALTH','-ApprovedOrigin','https://FLEET.syntheticvendor.tld');report=$true },
        @{ name='origin-has-path';extra=@('-ConfirmLive','PROBE_PUBLIC_HEALTH','-ApprovedOrigin',($origin+'/healthz'));report=$true }
    )
    foreach ($scenario in $badConsent) {
        $report = Join-Path $root ($scenario.name + '.json')
        $args = @('-NoProfile','-NonInteractive','-File',$probeFile,'-ConfigPath',$config,'-ReportPath',$report) + $scenario.extra
        $child = Invoke-N43Child -Arguments $args
        if ($child.exit -eq 0 -or $child.output.Contains($secret) -or $child.output.Contains($hostname)) {
            throw 'N43 bad consent was accepted or exposed configured host/secret.'
        }
        if ($scenario.report) {
            if (-not (Test-Path -LiteralPath $report -PathType Leaf)) {
                throw 'Refused N43 host mismatch failed to create redacted evidence.'
            }
            $raw = [IO.File]::ReadAllText($report)
            $record = $raw | ConvertFrom-Json -ErrorAction Stop
            if ($record.https_health_probe -cne 'BLOCKED' -or
                $record.diagnostic_phase -cne 'VALIDATE_ENDPOINT' -or
                $record.certified_for_production -ne $false -or
                $raw.Contains($hostname) -or $raw.Contains($secret)) {
                throw 'N43 refused origin produced unsafe/non-redacted evidence.'
            }
        } elseif (Test-Path -LiteralPath $report) {
            throw 'N43 refused consent prior to config read should not create evidence.'
        }
    }

    # The standard offline path must still work without an approved origin.
    $dryReport = Join-Path $root 'valid-dry-run.json'
    $child = Invoke-N43Child -Arguments @('-NoProfile','-NonInteractive','-File',$probeFile,
        '-ConfigPath',$config,'-ReportPath',$dryReport,'-DryRun')
    if ($child.exit -ne 0 -or -not (Test-Path -LiteralPath $dryReport -PathType Leaf)) {
        throw 'N43 hardened origin consent unexpectedly blocked offline dry run.'
    }
    $record = Get-Content -LiteralPath $dryReport -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($record.https_health_probe -cne 'PENDING' -or $record.certified_for_production -ne $false) {
        throw 'N43 offline dry run incorrectly approved external production.'
    }
    Write-Host 'N43 PASS: injected transport/TLS/redirect/oversize/JSON faults and hostname-bound consent on Windows; zero live requests.'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
# WinPS 5.1 inherits last expected failing native child exit code otherwise.
exit 0
