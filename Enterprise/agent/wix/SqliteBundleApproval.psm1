#Requires -Version 5.1
# N54: offline, independently approved SHA-256 admission for the sqlite.org
# ZIP and the actual extracted sqlite3.exe shipped in an MSI release.
# This module never downloads, executes, or approves any artifact itself.
Set-StrictMode -Version Latest

function Assert-N54ApprovedSqliteFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][ValidateSet('Archive','Executable')][string]$Kind,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedSha256
    )
    $stream = $null
    $hasher = $null
    try {
        # Approval is externally supplied from protected release custody.
        # Never infer it from the file being checked, a sibling .sha file,
        # the same HTTP host or a synthetic CI-generated test digest.
        if ($ApprovedSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z' -or
            [string]::IsNullOrWhiteSpace($Path) -or
            -not [IO.Path]::IsPathRooted($Path) -or
            $Path.StartsWith('\\',[StringComparison]::Ordinal)) {
            throw 'Unapproved artifact input.'
        }
        $full = [IO.Path]::GetFullPath($Path)
        if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($full)).DriveType -ne
            [IO.DriveType]::Fixed) {
            throw 'Only local fixed-disk artifacts accepted.'
        }
        $cursor = [IO.Path]::GetDirectoryName($full)
        while (-not [string]::IsNullOrWhiteSpace($cursor)) {
            $ancestor = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if ($ancestor -isnot [IO.DirectoryInfo] -or
                ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Reparse ancestor refused.'
            }
            $above = [IO.Path]::GetDirectoryName($cursor.TrimEnd('\'))
            if ([string]::IsNullOrWhiteSpace($above) -or $above -ceq $cursor) {
                break
            }
            $cursor = $above
        }
        $file = Get-Item -LiteralPath $full -Force -ErrorAction Stop
        $limit = if ($Kind -ceq 'Archive') { 67108864 } else { 33554432 }
        if ($file -isnot [IO.FileInfo] -or
            ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $file.Length -lt 1 -or $file.Length -gt $limit) {
            throw 'Unexpected size or file type.'
        }
        # Exclusive of writers while hashing. No mutable FileShare.ReadWrite.
        $stream = [IO.File]::Open($full,[IO.FileMode]::Open,
            [IO.FileAccess]::Read,[IO.FileShare]::Read)
        if ($stream.Length -lt 1 -or $stream.Length -gt $limit) {
            throw 'Artifact length changed.'
        }
        $hasher = [Security.Cryptography.SHA256]::Create()
        $digest = $hasher.ComputeHash($stream)
        if ($digest.Length -ne 32 -or $stream.Length -ne $file.Length) {
            throw 'Artifact changed during hash.'
        }
        $different = 0
        for ($i = 0; $i -lt 32; $i++) {
            $approved = [Convert]::ToByte($ApprovedSha256.Substring(2*$i,2),16)
            $different = $different -bor ([int]$approved -bxor [int]$digest[$i])
        }
        if ($different -ne 0) { throw 'Unapproved SQLite artifact.' }
        return $true
    } catch {
        # No local directory, remote URL, observed digest or release pin leaks.
        throw 'N54 SQLite signed-release payload approval blocked.'
    } finally {
        if ($null -ne $hasher) { $hasher.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

Export-ModuleMember -Function Assert-N54ApprovedSqliteFile
