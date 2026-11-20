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

# N49: Per-invocation signer-certificate pin. A valid Windows Authenticode
# result and an O=Microsoft Corporation text claim do not independently bind
# the approved publisher signing certificate. Require an independently
# witnessed SHA-256 of the DER leaf signing certificate before any DNS/HTTP.
# Hashing the same machine's current cert in CI only exercises the code:
# that is NOT independent customer signer provenance/production approval.
function Assert-PublicWindowsApprovedCurlSignerPin {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$SignerCertificate,
        [Parameter(Mandatory=$true)][AllowEmptyString()]
        [string]$ApprovedSignerSha256
    )
    $hasher = $null
    try {
        # Exactly 32 bytes, no spaces, delimiters, 0x prefixes, separators,
        # ambiguity from Unicode case folding or truncation.
        if ($ApprovedSignerSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
            throw 'Invalid signer certificate approval.'
        }
        $raw = $SignerCertificate.RawData
        if ($null -eq $raw -or $raw.Length -lt 1) {
            throw 'Missing signing certificate DER.'
        }
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        $actual = $hasher.ComputeHash($raw)
        if ($actual.Length -ne 32) { throw 'Unexpected SHA-256 digest length.' }
        $different = 0
        for ($i = 0; $i -lt 32; $i++) {
            $expected = [Convert]::ToByte($ApprovedSignerSha256.Substring($i*2,2),16)
            $different = $different -bor ([int]$expected -bxor [int]$actual[$i])
        }
        if ($different -ne 0) { throw 'Signing certificate is not approved.' }
        return $true
    } catch {
        # Never put the supplied fingerprint or actual certificate identity
        # into exceptions or the Windows operator acceptance report.
        throw 'Trusted Windows system curl signer pin blocked.'
    } finally {
        if ($null -ne $hasher) { $hasher.Dispose() }
    }
}

# N50: independently approved OS curl BINARY digest, distinct from the N49
# DER leaf signing certificate hash. Microsoft-signed executables can differ
# across OS updates; do not approve a new executable merely because the
# signing certificate matches. Hash bytes incrementally using a stream.
function Assert-PublicWindowsApprovedCurlBinaryPin {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$BinaryPath,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedBinarySha256
    )
    $stream = $null
    $sha = $null
    try {
        if ($ApprovedBinarySha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
            throw 'Malformed binary pin.'
        }
        if (-not [IO.Path]::IsPathRooted($BinaryPath)) {
            throw 'Nonabsolute binary path.'
        }
        $info = Get-Item -LiteralPath $BinaryPath -Force -ErrorAction Stop
        if ($info -isnot [IO.FileInfo] -or
            ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $info.Length -lt 1 -or $info.Length -gt 67108864) {
            throw 'Unexpected executable type or size.'
        }
        # Refuse write-sharing while the bytes are being hashed. An admin
        # could still replace the file after this handle closes; neither
        # this check nor CI substitutes for independent Windows review.
        $stream = [IO.File]::Open($BinaryPath,[IO.FileMode]::Open,
            [IO.FileAccess]::Read,[IO.FileShare]::Read)
        if ($stream.Length -lt 1 -or $stream.Length -gt 67108864) {
            throw 'Executable changed size before hashing.'
        }
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $actual = $sha.ComputeHash($stream)
        if ($actual.Length -ne 32) { throw 'Unexpected digest length.' }
        $different = 0
        for ($i = 0; $i -lt 32; $i++) {
            $expected = [Convert]::ToByte($ApprovedBinarySha256.Substring($i*2,2),16)
            $different = $different -bor ([int]$expected -bxor [int]$actual[$i])
        }
        if ($different -ne 0) { throw 'Executable is not on approved release digest.' }
        return $true
    } catch {
        # Never emit the local Windows path, actual approved or supplied
        # digest, signer identity, or file bytes to the user-visible report.
        throw 'Trusted Windows system curl binary pin blocked.'
    } finally {
        if ($null -ne $sha) { $sha.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Assert-PublicWindowsTrustedSystemCurl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedSignerSha256,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedBinarySha256
    )
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
        $null = Assert-PublicWindowsApprovedCurlSignerPin -SignerCertificate $signature.SignerCertificate -ApprovedSignerSha256 $ApprovedSignerSha256
        $null = Assert-PublicWindowsApprovedCurlBinaryPin -BinaryPath $curlPath -ApprovedBinarySha256 $ApprovedBinarySha256
        $nativeVersion = @(& $curlPath -q --version 2>$null)
        $nativeExit = $LASTEXITCODE
        $null = Assert-PublicWindowsCurlVersionHeader -ExitCode $nativeExit -VersionLines $nativeVersion
        # Re-check after launching native curl to detect a changed executable
        # before accepting the identity as stable. Not atomic against admin.
        $null = Assert-PublicWindowsApprovedCurlBinaryPin -BinaryPath $curlPath -ApprovedBinarySha256 $ApprovedBinarySha256
        return $curlPath
    } catch {
        throw 'Trusted Windows system curl preflight blocked.'
    }
}

Export-ModuleMember -Function Assert-PublicWindowsTrustedSystemCurl, Assert-PublicWindowsCurlVersionHeader, Assert-PublicWindowsApprovedCurlSignerPin, Assert-PublicWindowsApprovedCurlBinaryPin
