#Requires -Version 5.1
# Phase N55: offline final signed-artifact checksum-manifest admission.
# Do not infer a release approval from these hashes: separately verified
# Authenticode, publisher identity, environment and SQLite pins are required.
Set-StrictMode -Version Latest

function Get-N55LocalFile {
    param([string]$Path,[long]$Limit)
    if ([string]::IsNullOrWhiteSpace($Path) -or
        -not [IO.Path]::IsPathRooted($Path) -or
        $Path.StartsWith('\\',[StringComparison]::Ordinal)) {
        throw 'Untrusted file location.'
    }
    $full = [IO.Path]::GetFullPath($Path)
    if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($full)).DriveType -ne [IO.DriveType]::Fixed) {
        throw 'Nonlocal file refused.'
    }
    $cursor = [IO.Path]::GetDirectoryName($full)
    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        $ancestor = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
        if ($ancestor -isnot [IO.DirectoryInfo] -or
            ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Redirected ancestor.'
        }
        $above = [IO.Path]::GetDirectoryName($cursor.TrimEnd('\'))
        if ([string]::IsNullOrWhiteSpace($above) -or $above -ceq $cursor) { break }
        $cursor = $above
    }
    $file = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if ($file -isnot [IO.FileInfo] -or
        ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $file.Length -lt 1 -or $file.Length -gt $Limit) {
        throw 'Untrusted file size or type.'
    }
    return $file
}

function Get-N55ReadManifest {
    param([IO.FileInfo]$File)
    $stream = $null
    try {
        $stream = [IO.File]::Open($File.FullName,[IO.FileMode]::Open,
            [IO.FileAccess]::Read,[IO.FileShare]::Read)
        if ($stream.Length -lt 1 -or $stream.Length -gt 1024) {
            throw 'Manifest exceeded bound.'
        }
        $raw = [byte[]]::new([int]$stream.Length)
        $offset=0
        while ($offset -lt $raw.Length) {
            $read=$stream.Read($raw,$offset,$raw.Length-$offset)
            if ($read -le 0) { throw 'Manifest truncated.' }
            $offset += $read
        }
        foreach ($b in $raw) {
            if ($b -gt 127 -or $b -eq 0) { throw 'Manifest not ASCII.' }
        }
        return [Text.Encoding]::ASCII.GetString($raw)
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Test-N55ArtifactSha256 {
    param([IO.FileInfo]$File,[string]$Digest,[long]$Limit)
    $stream = $null
    $sha = $null
    try {
        $stream=[IO.File]::Open($File.FullName,[IO.FileMode]::Open,
            [IO.FileAccess]::Read,[IO.FileShare]::Read)
        if ($stream.Length -lt 1 -or $stream.Length -gt $Limit) { throw 'Artifact size changed.' }
        $sha=[Security.Cryptography.SHA256]::Create()
        $actual=$sha.ComputeHash($stream)
        if ($actual.Length -ne 32 -or $stream.Length -ne $File.Length) {
            throw 'Artifact changed during hashing.'
        }
        $difference=0
        for ($i=0;$i -lt 32;$i++) {
            $approved=[Convert]::ToByte($Digest.Substring(2*$i,2),16)
            $difference=$difference -bor ([int]$approved -bxor [int]$actual[$i])
        }
        if ($difference -ne 0) { throw 'Released bytes differ from signed manifest.' }
    } finally {
        if ($null -ne $sha) { $sha.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Assert-N55SignedPublicationManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$OutputDirectory,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedAgentVersion
    )
    try {
        if ($ExpectedAgentVersion -cnotmatch '\A(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,3})\z') {
            throw 'Untrusted expected version.'
        }
        $root = [IO.Path]::GetFullPath($OutputDirectory)
        $manifest = Get-N55LocalFile -Path (Join-Path $root 'SHA256SUMS.txt') -Limit 1024
        $exe = Get-N55LocalFile -Path (Join-Path $root 'IT-Toolkit-Agent.exe') -Limit 67108864
        $msiName = 'IT-Toolkit-Agent-'+$ExpectedAgentVersion+'.msi'
        $msi = Get-N55LocalFile -Path (Join-Path $root $msiName) -Limit 268435456
        $allMsis = @(Get-ChildItem -LiteralPath $root -File -Filter 'IT-Toolkit-Agent-*.msi')
        if ($allMsis.Count -ne 1 -or $allMsis[0].Name -cne $msiName) {
            throw 'Unexpected MSI candidates.'
        }
        # Release-Sign.ps1 writes precisely these two lowercase SHA256SUMS
        # lines in this order, with a final LF (Windows CRLF also allowed).
        # Reject duplicate entries, traversal, comments and extra payloads.
        $record = Get-N55ReadManifest -File $manifest
        $pattern = '\A(?<exe>[0-9a-f]{64})  IT-Toolkit-Agent\.exe\r?\n' +
            '(?<msi>[0-9a-f]{64})  ' +
            [regex]::Escape($msiName) + '\r?\n\z'
        $match = [regex]::Match($record,$pattern,
            [Text.RegularExpressions.RegexOptions]::CultureInvariant)
        if (-not $match.Success) { throw 'Manifest format not canonical.' }
        Test-N55ArtifactSha256 -File $exe -Digest $match.Groups['exe'].Value -Limit 67108864
        Test-N55ArtifactSha256 -File $msi -Digest $match.Groups['msi'].Value -Limit 268435456
        return $true
    } catch {
        # Never include a local path, raw digest, executable data or cert.
        throw 'N55 signed publication manifest blocked.'
    }
}

Export-ModuleMember -Function Assert-N55SignedPublicationManifest
