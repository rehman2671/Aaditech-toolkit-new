#Requires -Version 5.1
# N65: inspect a separately SHA-approved NUPKG as an untrusted ZIP *before*
# extraction or dotnet tool restore. Reject traversal, ambiguous Windows
# names, links, duplicate entries and decompression/resource bombs.
# This is NOT a substitute for N63's independent archive SHA approval.
Set-StrictMode -Version Latest

function Assert-N65SafeCompilerArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][ValidateSet('ps2exe','wix')][string]$Kind,
        [Parameter(Mandatory=$true)][string]$PackagePath
    )
    $stream=$null
    $archive=$null
    try {
        if ($env:OS -cne 'Windows_NT') { throw 'Windows runner required.' }
        Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
        $package=Get-Item -LiteralPath $PackagePath -Force -ErrorAction Stop
        $maxArchive=if ($Kind -ceq 'ps2exe') { 16777216L } else { 268435456L }
        $maxExpanded=if ($Kind -ceq 'ps2exe') { 67108864L } else { 536870912L }
        $maxEntry=if ($Kind -ceq 'ps2exe') { 33554432L } else { 268435456L }
        if ($package -isnot [IO.FileInfo] -or
            ($package.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $package.Length -lt 1 -or $package.Length -gt $maxArchive) {
            throw 'Invalid archive file.'
        }
        $stream=[IO.File]::Open($package.FullName,[IO.FileMode]::Open,
            [IO.FileAccess]::Read,[IO.FileShare]::Read)
        $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read,$true)
        $entries=@($archive.Entries)
        if ($entries.Count -lt 1 -or $entries.Count -gt 4096) {
            throw 'Invalid archive entry count.'
        }
        $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $total=[long]0
        $buffer=New-Object byte[] 65536
        foreach ($entry in $entries) {
            $path=[string]$entry.FullName
            if ([string]::IsNullOrWhiteSpace($path) -or
                $path.Length -gt 260 -or
                $path.StartsWith('/') -or
                $path.IndexOf('\') -ge 0 -or
                $path.IndexOf(':') -ge 0 -or
                $path -match '[\x00-\x1F\x7F]') {
                throw 'Invalid archive entry name.'
            }
            $isDirectory=$path.EndsWith('/')
            $key=if ($isDirectory) { $path.Substring(0,$path.Length-1) } else { $path }
            $segments=@($key.Split('/'))
            foreach ($segment in $segments) {
                if ([string]::IsNullOrWhiteSpace($segment) -or
                    $segment -ceq '.' -or $segment -ceq '..' -or
                    $segment.EndsWith('.') -or $segment.EndsWith(' ') -or
                    $segment -match '[<>|"?*]' -or
                    $segment -match '\A(?i:(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]))(?:\..*)?\z') {
                    throw 'Ambiguous Windows ZIP name.'
                }
            }
            if (-not $seen.Add($key)) {
                throw 'Case-insensitive archive entry collision.'
            }
            # Reject Unix symlinks and Windows reparse-point entries, even
            # where Windows extraction might not interpret them as links.
            $unixType=($entry.ExternalAttributes -shr 16) -band 61440
            $dosAttributes=$entry.ExternalAttributes -band 65535
            if ($unixType -eq 40960 -or
                ($dosAttributes -band [int][IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Linked archive entry.'
            }
            if ($entry.Length -lt 0 -or $entry.CompressedLength -lt 0 -or
                $entry.Length -gt $maxEntry -or
                ($isDirectory -and $entry.Length -ne 0) -or
                ($entry.Length -gt 0 -and $entry.CompressedLength -eq 0)) {
                throw 'Invalid compressed entry.'
            }
            $total += [long]$entry.Length
            if ($total -gt $maxExpanded -or
                ($entry.Length -gt 1048576L -and
                 ([double]$entry.Length/[math]::Max(1,[double]$entry.CompressedLength)) -gt 4000.0)) {
                throw 'Excessive ZIP expansion.'
            }
            # Inspect actual decompression, not only attacker-controlled ZIP
            # central-directory lengths. No extracted file is created here.
            $reader=$null
            try {
                $reader=$entry.Open()
                $received=[long]0
                do {
                    $read=$reader.Read($buffer,0,$buffer.Length)
                    if ($read -lt 0) { throw 'Invalid ZIP stream.' }
                    $received += $read
                    if ($received -gt $entry.Length -or $received -gt $maxEntry) {
                        throw 'ZIP stream exceeded declared bound.'
                    }
                } while ($read -gt 0)
                if ($received -ne $entry.Length) {
                    throw 'ZIP entry stream truncated.'
                }
            } finally {
                if ($null -ne $reader) { $reader.Dispose() }
            }
        }
        return $true
    } catch {
        # Never emit package paths, filenames, approved digests or content.
        throw 'N65 compiler archive entry safety blocked.'
    } finally {
        if ($null -ne $archive) { $archive.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

Export-ModuleMember -Function Assert-N65SafeCompilerArchive
