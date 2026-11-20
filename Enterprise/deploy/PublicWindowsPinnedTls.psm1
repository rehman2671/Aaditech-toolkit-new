#Requires -Version 5.1
# Phase N42: PURE argument construction for an explicitly authorized Windows
# public HTTPS read-only health check. No resolver, HTTP, TLS or side effects.
Set-StrictMode -Version Latest
Import-Module -Name (Join-Path $PSScriptRoot 'PublicWindowsAddressPolicy.psm1') -Force -ErrorAction Stop
Import-Module -Name (Join-Path $PSScriptRoot 'ValidateWindowsHealthJson.psm1') -Force -ErrorAction Stop

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

# N43: Offline, testable final acceptance policy for a SINGLE native curl
# transfer. The status/exit-code combination is injected by caller; this
# function never opens DNS, sockets, HTTP, system trust or external processes.
# The live wrapper MUST pass its actual native exit code and stdout unchanged.
function Assert-PublicWindowsPinnedHealthResult {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][int]$TransportExitCode,
        [Parameter(Mandatory=$true)][AllowEmptyCollection()][string[]]$StatusLines,
        [Parameter(Mandatory=$true)][string]$ResponsePath
    )
    $stream = $null
    try {
        # Native failures include DNS, connect, TLS, timeout, curl size limit,
        # proxy errors and any protocol error. HTTP 3xx (including internal
        # Location redirects) is not accepted even if curl writes health JSON.
        if ($TransportExitCode -ne 0 -or $StatusLines.Count -ne 1 -or
            $StatusLines[0] -cne '200') {
            throw 'Unsuccessful HTTPS transport.'
        }
        $info = Get-Item -LiteralPath $ResponsePath -ErrorAction Stop
        if ($info -isnot [IO.FileInfo] -or
            ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $info.Length -lt 1 -or $info.Length -gt 65536) {
            throw 'Untrusted HTTPS response file.'
        }
        # Open only AFTER checking file length; read at most 64 KiB. Recheck
        # size on the actual opened handle to avoid a file-replacement/size
        # race, without allocating arbitrary untrusted response lengths.
        $stream = [IO.File]::Open($ResponsePath, [IO.FileMode]::Open,
            [IO.FileAccess]::Read, [IO.FileShare]::None)
        if ($stream.Length -lt 1 -or $stream.Length -gt 65536) {
            throw 'HTTPS response handle exceeded bound.'
        }
        $size = [int]$stream.Length
        $jsonBytes = [byte[]]::new($size)
        $offset = 0
        while ($offset -lt $size) {
            $read = $stream.Read($jsonBytes, $offset, $size - $offset)
            if ($read -le 0) { throw 'Truncated HTTPS response.' }
            $offset += $read
        }
        if ($stream.ReadByte() -ne -1) {
            throw 'HTTPS response grew while reading.'
        }
        $null = Assert-PublicWindowsHealthJson -JsonUtf8 $jsonBytes
        return $true
    } catch {
        # Never echo curl stderr, raw status/host, payload, path or byte data.
        throw 'Public Windows pinned HTTPS health result blocked.'
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

Export-ModuleMember -Function New-PublicWindowsPinnedCurlArguments, Assert-PublicWindowsPinnedHealthResult
