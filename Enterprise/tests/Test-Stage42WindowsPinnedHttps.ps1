#Requires -Version 5.1
# Phase N42 offline-only regression. NEVER supplies live consent with valid
# configuration: no DNS lookup, socket, HTTP request or customer information.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$modulePath = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\PublicWindowsPinnedTls.psm1'))
$operatorScript = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
$policy = [IO.File]::ReadAllText($modulePath)
foreach ($forbidden in @('GetHostAddresses','Invoke-RestMethod','Invoke-WebRequest','curl.exe','TcpClient')) {
    if ($policy.IndexOf($forbidden,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'N42 pure argument policy unexpectedly contains network operations.'
    }
}
Import-Module -Name $modulePath -Force -ErrorAction Stop

$hostname = 'fleet.syntheticvendor.tld'
$endpoint = 'https://' + $hostname + '/api/v1/ingest/telemetry'
$dir = Join-Path ([IO.Path]::GetTempPath()) ('n42-offline-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir -Force | Out-Null
try {
    $response = Join-Path $dir 'response.json'
    $args = @(New-PublicWindowsPinnedCurlArguments -Endpoint $endpoint -ResolvedAddressLiterals @('2606:4700:4700::1111','8.8.8.8') -ResponsePath $response)
    if ($args.Count -lt 25 -or $args[0] -cne '-q' -or
        @($args | Where-Object { $_ -ceq '--resolve' }).Count -ne 1 -or
        $args[[array]::IndexOf($args, '--resolve') + 1] -cne ($hostname + ':443:8.8.8.8') -or
        $args[[array]::IndexOf($args, '--noproxy') + 1] -cne '*' -or
        $args[[array]::IndexOf($args, '--proto') + 1] -cne '=https' -or
        $args[[array]::IndexOf($args, '--max-redirs') + 1] -cne '0' -or
        $args[[array]::IndexOf($args, '--max-filesize') + 1] -cne '65536' -or
        $args[[array]::IndexOf($args, '--output') + 1] -cne $response -or
        $args[[array]::IndexOf($args, '--write-out') + 1] -cne '%{http_code}' -or
        $args[$args.Count-1] -cne ('https://' + $hostname + '/healthz')) {
        throw 'N42 curl argument plan lacks mandatory pinned TLS safety flags.'
    }
    foreach ($unsafe in @('--location','-L','--insecure','-k','--cacert','--proxy','--proxy-user','--netrc','--config','-K','--request','--data','--form')) {
        if ($args -ccontains $unsafe) { throw 'N42 plan included unsafe transport option.' }
    }
    $ipv6 = @(New-PublicWindowsPinnedCurlArguments -Endpoint $endpoint -ResolvedAddressLiterals @('2606:4700:4700::1111') -ResponsePath $response)
    if ($ipv6[[array]::IndexOf($ipv6,'--resolve')+1] -cne ($hostname+':443:[2606:4700:4700::1111]')) {
        throw 'Public IPv6 connection destination is not bracket-pinned.'
    }

    foreach ($answers in @(
        @('10.0.0.1'),
        @('8.8.8.8','169.254.169.254'),
        @('8.8.8.8','::ffff:127.0.0.1'),
        @('2001:db8::1'),
        @('198.51.100.4')
    )) {
        $rejected = $false
        try {
            $null = @(New-PublicWindowsPinnedCurlArguments -Endpoint $endpoint -ResolvedAddressLiterals $answers -ResponsePath $response)
        } catch {
            $rejected = $true
            if ([string]$_.Exception.Message -cne 'Public Windows pinned HTTPS plan blocked.') {
                throw 'Untrusted DNS input was disclosed by pinned plan.'
            }
        }
        if (-not $rejected) { throw 'Private/mixed DNS set admitted to pinned HTTPS plan.' }
    }

    # Actual operator wrapper, always invoked without live consent or in
    # dry-run mode. Even a config that looks provisioned must not call DNS.
    $config = Join-Path $dir 'agent.json'
    $secret = 'N42-SYNTHETIC-TOKEN-MUST-NEVER-PRINT'
    @{ endpoint=$endpoint; token=$secret; needs_setup=$false } |
        ConvertTo-Json | Set-Content -LiteralPath $config -Encoding utf8

    $report = Join-Path $dir 'dryrun.json'
    $runner = if ($PSVersionTable.PSVersion.Major -le 5) { 'powershell.exe' } else { 'pwsh.exe' }
    $baseArgs = @('-NoProfile','-NonInteractive','-File',$operatorScript,
        '-ConfigPath',$config,'-ReportPath',$report)
    foreach ($scenario in @('missing-consent','wrong-consent','dryrun-with-consent')) {
        $extra = @()
        if ($scenario -eq 'wrong-consent') { $extra = @('-ConfirmLive','INVALID') }
        if ($scenario -eq 'dryrun-with-consent') { $extra = @('-DryRun','-ConfirmLive','PROBE_PUBLIC_HEALTH') }
        $output = @(& $runner @baseArgs @extra 2>&1 | Out-String)
        if ($LASTEXITCODE -eq 0 -or (Test-Path -LiteralPath $report)) {
            throw 'Refused N42 invocation started a probe or created evidence.'
        }
        if (($output -join '').Contains($secret) -or
            ($output -join '').Contains($hostname)) {
            throw 'N42 refusal leaked customer-looking configuration.'
        }
    }

    $output = @(& $runner @baseArgs '-DryRun' 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $report -PathType Leaf)) {
        throw 'Offline N42 operator dry run failed.'
    }
    $raw = [IO.File]::ReadAllText($report)
    $obj = $raw | ConvertFrom-Json -ErrorAction Stop
    if ($obj.https_health_probe -cne 'PENDING' -or
        $obj.mode -cne 'OFFLINE_DRY_RUN' -or
        $obj.certified_for_production -ne $false -or
        $raw.Contains($secret) -or $raw.Contains($hostname) -or
        ($output -join '').Contains($secret) -or ($output -join '').Contains($hostname)) {
        throw 'Offline report leaked sensitive data or falsely certified HTTPS.'
    }
    $oldBytes = [IO.File]::ReadAllBytes($report)
    $null = @(& $runner @baseArgs '-DryRun' 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -or
        [Convert]::ToBase64String($oldBytes) -cne
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($report))) {
        throw 'N42 report was overwritten on a repeated invocation.'
    }

    # Code-level hard stops: N31 still denies -NetworkProbe; N42 only runs
    # when called directly with explicit operator consent.
    $n31 = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Test-CustomerWindowsAcceptance.ps1'))
    if ($n31.IndexOf("Add-Check 'public_https' 'BLOCKED'",[StringComparison]::Ordinal) -lt 0) {
        throw 'N31 customer acceptance probe was unexpectedly enabled.'
    }
    Write-Host 'N42 PASS: offline consent/dryrun, redacted immutable report and public IP-pinned curl plan.'
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
