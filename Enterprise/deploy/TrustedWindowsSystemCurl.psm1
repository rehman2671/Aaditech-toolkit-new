#Requires -Version 5.1
# N48: LOCAL operator-host trusted curl provenance and Schannel preflight.
# This module never resolves an application hostname, opens a socket, makes
# an HTTP request, or reads agent credentials. Authenticode relies on Windows
# trust policy; it is NOT independent publisher/CA custody attestation.
Set-StrictMode -Version Latest

function Assert-PublicWindowsCurlVersionHeader {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][int]$ExitCode,
        [Parameter(Mandatory=$true)][AllowEmptyCollection()][string[]]$VersionLines
    )
    try {
        if ($ExitCode -ne 0 -or $VersionLines.Count -lt 1 -or
            $VersionLines.Count -gt 32) {
            throw 'Native version command failed.'
        }
        # Only the actual leading curl/libcurl build line can identify its
        # compiled TLS backend. A later "Features:" line or arbitrary stderr
        # text containing "Schannel" is NOT sufficient. Require exactly one
        # initial curl version header and the Schannel backend on that header.
        $first = [string]$VersionLines[0]
        if ($first.Length -gt 1024 -or $first -cnotmatch
            '\Acurl [0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?\s+.*\bSchannel\b') {
            throw 'Unexpected Windows curl TLS backend.'
        }
        foreach ($line in $VersionLines) {
            if ($null -eq $line -or ([string]$line).Length -gt 2048) {
                throw 'Unbounded native version output.'
            }
        }
        return $true
    } catch {
        # Never echo raw process stdout, path, version, certificate data,
        # customer host, or process environment to a report.
        throw 'Trusted Windows system curl preflight blocked.'
    }
}

function Assert-PublicWindowsTrustedSystemCurl {
    [CmdletBinding()]
    param()
    try {
        if ($env:OS -cne 'Windows_NT') {
            throw 'Windows required.'
        }
        # Never resolve a PATH-controlled, package-manager, alias or locally
        # downloaded curl. The OS Windows directory is trusted only to the
        # extent its ACL and Microsoft Authenticode are trustworthy.
        $systemDirectory = [Environment]::SystemDirectory
        if ([string]::IsNullOrWhiteSpace($systemDirectory) -or
            -not [IO.Path]::IsPathRooted($systemDirectory)) {
            throw 'Windows system directory unavailable.'
        }
        $curlPath = [IO.Path]::Combine($systemDirectory, 'curl.exe')
        $info = Get-Item -LiteralPath $curlPath -Force -ErrorAction Stop
        if ($info -isnot [IO.FileInfo] -or
            ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $info.Length -lt 1) {
            throw 'System curl file is missing or redirected.'
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $curlPath -ErrorAction Stop
        if ($signature.Status -ne 'Valid' -or
            $null -eq $signature.SignerCertificate) {
            throw 'System curl signature invalid.'
        }
        # Avoid a substring-only company check (e.g. O=Not Microsoft
        # Corporation). This is still OS trust and is not an externally pinned
        # Microsoft code signing trust chain. External review is required.
        $subject = [string]$signature.SignerCertificate.Subject
        if ($subject -notmatch '(?i)(?:\A|,\s*)O=Microsoft Corporation(?:,|\z)') {
            throw 'System curl is not signed by the expected organization.'
        }
        $nativeVersion = @(& $curlPath -q --version 2>$null)
        $nativeExit = $LASTEXITCODE
        $null = Assert-PublicWindowsCurlVersionHeader -ExitCode $nativeExit -VersionLines $nativeVersion
        return $curlPath
    } catch {
        throw 'Trusted Windows system curl preflight blocked.'
    }
}

Export-ModuleMember -Function Assert-PublicWindowsTrustedSystemCurl, Assert-PublicWindowsCurlVersionHeader
