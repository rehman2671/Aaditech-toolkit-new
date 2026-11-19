#Requires -Version 5.1
# N39: PURE / OFFLINE public-address policy for future Windows pinned-HTTPS work.
# This module NEVER resolves DNS or performs HTTP. A result is not a TLS or
# customer production acceptance attestation.
Set-StrictMode -Version Latest

function Test-AddressWithinCidr {
    param(
        [Parameter(Mandatory=$true)][System.Net.IPAddress]$Address,
        [Parameter(Mandatory=$true)][string]$Network,
        [Parameter(Mandatory=$true)][int]$Prefix
    )
    $base = [System.Net.IPAddress]::Parse($Network)
    if ($base.AddressFamily -ne $Address.AddressFamily) { return $false }
    $left = $Address.GetAddressBytes()
    $right = $base.GetAddressBytes()
    if ($Prefix -lt 0 -or $Prefix -gt ($left.Length * 8)) {
        throw 'Invalid internal CIDR policy.'
    }
    $whole = [int][Math]::Floor($Prefix / 8)
    for ($i=0; $i -lt $whole; $i++) {
        if ($left[$i] -ne $right[$i]) { return $false }
    }
    $remainder = $Prefix % 8
    if ($remainder -eq 0) { return $true }
    $mask = (255 -shl (8 - $remainder)) -band 255
    return (($left[$whole] -band $mask) -eq ($right[$whole] -band $mask))
}

function Assert-PublicWindowsDnsName {
    param([Parameter(Mandatory=$true)][string]$DnsHost)
    # Reject URLs, Unicode confusables, whitespace, numeric TLDs, IP aliases,
    # userinfo and reserved zones BEFORE anyone considers using an OS resolver.
    if ($DnsHost.Length -gt 253 -or
        $DnsHost -cnotmatch '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$') {
        throw 'Public DNS hostname policy blocked.'
    }
    $parsed = $null
    if ([System.Net.IPAddress]::TryParse($DnsHost, [ref]$parsed)) {
        throw 'Public DNS hostname policy blocked.'
    }
    $labels = $DnsHost.Split('.')
    foreach ($label in $labels) {
        if ($label.Length -gt 63 -or $label -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$') {
            throw 'Public DNS hostname policy blocked.'
        }
    }
    if ($labels[$labels.Length - 1] -notmatch '^[A-Za-z][A-Za-z0-9-]*$') {
        throw 'Public DNS hostname policy blocked.'
    }
    $hostLower = $DnsHost.ToLowerInvariant()
    if ($hostLower -match '(\.|^)(local|localhost|test|example|invalid|internal|onion|arpa)$' -or
        $hostLower -match '(^|\.)(example\.com|example\.net|example\.org)$') {
        throw 'Public DNS hostname policy blocked.'
    }
}

function Test-GlobalWindowsAddress {
    param([Parameter(Mandatory=$true)][System.Net.IPAddress]$Address)
    $family = $Address.AddressFamily
    $v4 = [System.Net.Sockets.AddressFamily]::InterNetwork
    $v6 = [System.Net.Sockets.AddressFamily]::InterNetworkV6
    if ($family -eq $v4) {
        # Conservative fail-closed IPv4 exclusions: current special-use,
        # shared, documentation, metadata, benchmarking, multicast and reserved.
        foreach ($cidr in @(
            @('0.0.0.0',8), @('10.0.0.0',8), @('100.64.0.0',10),
            @('127.0.0.0',8), @('169.254.0.0',16), @('172.16.0.0',12),
            @('192.0.0.0',24), @('192.0.2.0',24), @('192.88.99.0',24),
            @('192.168.0.0',16), @('198.18.0.0',15),
            @('198.51.100.0',24), @('203.0.113.0',24),
            @('224.0.0.0',4), @('240.0.0.0',4)
        )) {
            if (Test-AddressWithinCidr -Address $Address -Network $cidr[0] -Prefix $cidr[1]) {
                return $false
            }
        }
        return $true
    }
    if ($family -ne $v6) { return $false }
    # Only globally allocated IPv6 unicast (2000::/3) is eligible,
    # with conservative exclusions for protocol tunnels, documentation and
    # special IANA 2001 and 3fff reservations. Mapped IPv4 fails this gate.
    if (-not (Test-AddressWithinCidr $Address '2000::' 3)) { return $false }
    foreach ($cidr in @(
        @('2001::',23), @('2001:db8::',32),
        @('2002::',16), @('3fff::',20)
    )) {
        if (Test-AddressWithinCidr -Address $Address -Network $cidr[0] -Prefix $cidr[1]) {
            return $false
        }
    }
    return $true
}

function Get-PublicWindowsAddressPin {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$DnsHost,
        [Parameter(Mandatory=$true)][string[]]$AddressLiterals
    )
    Assert-PublicWindowsDnsName -DnsHost $DnsHost
    if ($AddressLiterals.Count -eq 0) { throw 'Public DNS answer policy blocked.' }
    $selectedV4 = [System.Collections.Generic.List[string]]::new()
    $selectedV6 = [System.Collections.Generic.List[string]]::new()
    foreach ($literal in $AddressLiterals) {
        $ip = $null
        if (-not [System.Net.IPAddress]::TryParse($literal, [ref]$ip) -or
            -not (Test-GlobalWindowsAddress -Address $ip)) {
            # Never echo untrusted DNS answer values in validation failures.
            throw 'Public DNS answer policy blocked.'
        }
        if ($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
            $selectedV4.Add($ip.ToString())
        } else {
            $selectedV6.Add($ip.ToString())
        }
    }
    # Deterministic selection does not trust DNS reply order or allow a mixed
    # public/private answer set. Any one invalid A/AAAA fails the whole group.
    if ($selectedV4.Count -gt 0) {
        return (@($selectedV4 | Sort-Object)[0])
    }
    if ($selectedV6.Count -gt 0) {
        return ('[' + @($selectedV6 | Sort-Object)[0] + ']')
    }
    throw 'Public DNS answer policy blocked.'
}

# N40: Parse exactly the installer-managed telemetry URL, without resolving
# DNS. URI parsing alone allows private IP literals, userinfo, custom ports and
# percent-encoded aliases; none should count as a validated public setup.
# This is ONLY offline preflight and never establishes live TLS reachability.
function Test-PublicWindowsEndpointOrigin {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Endpoint)

    # Match the raw input instead of normalized [Uri] components so encoded
    # separators, fragments, userinfo and alternate/custom ports cannot hide.
    $match = [regex]::Match(
        $Endpoint,
        '\A(?i:https)://(?<dns>[A-Za-z0-9.-]+)(?::443)?/api/v1/ingest/telemetry\z',
        [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    )
    if (-not $match.Success) { throw 'Public HTTPS endpoint policy blocked.' }

    # Shares the independently tested N39 hostname rules; does not claim the
    # name resolves to public DNS or the certificate is trusted.
    try {
        Assert-PublicWindowsDnsName -DnsHost $match.Groups['dns'].Value
    } catch {
        throw 'Public HTTPS endpoint policy blocked.'
    }
    return ('https://' + $match.Groups['dns'].Value.ToLowerInvariant())
}

Export-ModuleMember -Function Get-PublicWindowsAddressPin, Test-PublicWindowsEndpointOrigin
