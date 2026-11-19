#Requires -Version 5.1
# Phase N42: PURE argument construction for an explicitly authorized Windows
# public HTTPS read-only health check. No resolver, HTTP, TLS or side effects.
Set-StrictMode -Version Latest
Import-Module -Name (Join-Path $PSScriptRoot 'PublicWindowsAddressPolicy.psm1') -Force -ErrorAction Stop

function New-PublicWindowsPinnedCurlArguments {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Endpoint,
        [Parameter(Mandatory=$true)][string[]]$ResolvedAddressLiterals,
        [Parameter(Mandatory=$true)][string]$ResponsePath
    )

    try {
        $origin = Test-PublicWindowsEndpointOrigin -Endpoint $Endpoint
        $dnsHost = $origin.Substring('https://'.Length)
        # N39 rejects *any* private, metadata, special-use or mapped answer,
        # including otherwise public+private mixed DNS response sets.
        $pin = Get-PublicWindowsAddressPin -DnsHost $dnsHost -AddressLiterals $ResolvedAddressLiterals
        if (-not [IO.Path]::IsPathRooted($ResponsePath) -or
            $ResponsePath.IndexOfAny([char[]]@(0,10,13)) -ge 0) {
            throw 'Output file path must be absolute.'
        }

        # The URL remains the approved DNS hostname for TLS SNI/hostname checks.
        # --resolve forces the *connection* to the already vetted IP, removing
        # the lookup-to-connect DNS rebinding window. -q MUST be first: no curlrc.
        # No --location, --insecure, --cacert or proxy forwarding is permitted.
        # --max-filesize is defense in depth: caller MUST re-check actual bytes.
        $arguments = [string[]]@(
            '-q',
            '--silent',
            '--noproxy', '*',
            '--proto', '=https',
            '--tlsv1.2',
            '--http1.1',
            '--retry', '0',
            '--max-redirs', '0',
            '--connect-timeout', '8',
            '--max-time', '18',
            '--max-filesize', '65536',
            '--resolve', ($dnsHost + ':443:' + $pin),
            '--output', $ResponsePath,
            '--write-out', '%{http_code}',
            ($origin + '/healthz')
        )
        return $arguments
    } catch {
        # Never echo a customer hostname, raw resolved IP, local file path or
        # other untrusted input into errors or acceptance reports.
        throw 'Public Windows pinned HTTPS plan blocked.'
    }
}

Export-ModuleMember -Function New-PublicWindowsPinnedCurlArguments
