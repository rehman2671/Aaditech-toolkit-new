#Requires -Version 5.1
# N64: a reviewed archive digest must bind *every* installed PS2EXE
# payload file, not only the manifest. Fail closed on changed bytes,
# unapproved additions, removals, symlinks, or oversized extraction.
Set-StrictMode -Version Latest

function Get-N64Ps2ExePayloadDigest {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Directory)
    try {
        $root=Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
        if ($root -isnot [IO.DirectoryInfo] -or
            ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Directory type invalid.'
        }
        $manifest=Join-Path $root.FullName 'ps2exe.psd1'
        $module=Join-Path $root.FullName 'ps2exe.psm1'
        foreach ($path in @($manifest,$module)) {
            $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
            if ($item -isnot [IO.FileInfo] -or
                ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                $item.Length -lt 1 -or $item.Length -gt 33554432L) {
                throw 'Compiler entrypoint invalid.'
            }
        }
        $entries=@(Get-ChildItem -LiteralPath $root.FullName -Force -Recurse -ErrorAction Stop)
        if ($entries.Count -lt 2 -or $entries.Count -gt 1024) {
            throw 'Extraction entry count invalid.'
        }
        $records=@()
        $total=[long]0
        foreach ($entry in $entries) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Linked or redirected payload blocked.'
            }
            if ($entry -is [IO.DirectoryInfo]) { continue }
            if ($entry -isnot [IO.FileInfo] -or $entry.Length -gt 33554432L) {
                throw 'Non-regular or oversized payload blocked.'
            }
            $total += [long]$entry.Length
            if ($total -gt 134217728L) { throw 'Expanded payload too large.' }
            $relative=$entry.FullName.Substring($root.FullName.Length).Replace('\','/')
            if ($relative.StartsWith('/')) { $relative=$relative.Substring(1) }
            if ([string]::IsNullOrEmpty($relative) -or $relative.Length -gt 1024) {
                throw 'Invalid package relative path.'
            }
            # Base64 makes the path unambiguous even when a file name contains
            # whitespace or a delimiter. Ordinal sorting is culture-neutral.
            $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($relative))
            $sha=(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
            $records+=($encoded+':'+$sha)
        }
        if ($records.Count -lt 2 -or $records.Count -gt 512) {
            throw 'Unexpected payload file count.'
        }
        [Array]::Sort($records,[StringComparer]::Ordinal)
        $message=[Text.Encoding]::UTF8.GetBytes([string]::Join("`n",$records))
        $hash=[Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($hash.ComputeHash($message))).Replace('-','').ToUpperInvariant()
        } finally {
            $hash.Dispose()
        }
    } catch {
        throw 'N64 PS2EXE payload audit blocked.'
    }
}

function Assert-N64ApprovedPs2ExePayload {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Directory,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedSha256
    )
    try {
        if ($env:OS -cne 'Windows_NT' -or
            $ApprovedSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
            throw 'Missing approved payload fingerprint.'
        }
        $actual=Get-N64Ps2ExePayloadDigest -Directory $Directory
        if ($actual -cne $ApprovedSha256.ToUpperInvariant()) {
            throw 'Installed code differs from verified archive.'
        }
        return $true
    } catch {
        throw 'N64 verified PS2EXE payload admission blocked.'
    }
}

Export-ModuleMember -Function Get-N64Ps2ExePayloadDigest,Assert-N64ApprovedPs2ExePayload
