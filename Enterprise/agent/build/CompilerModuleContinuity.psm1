#Requires -Version 5.1
# N64: verify every installed PS2EXE module file and directory against
# the SHA-approved, already-extracted source tree (N63), and recheck the
# full tree immediately before the protected build imports the compiler.
Set-StrictMode -Version Latest

function Get-N64CompilerModuleTreeDigest {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$ModuleDirectory)
    try {
        if ($env:OS -cne 'Windows_NT') { throw 'Windows build required.' }
        $root=Get-Item -LiteralPath $ModuleDirectory -Force -ErrorAction Stop
        if ($root -isnot [IO.DirectoryInfo] -or
            ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Unsafe compiler module root.'
        }
        $base=[IO.Path]::GetFullPath($root.FullName).TrimEnd([char[]]@('\','/'))
        $entries=@(Get-ChildItem -LiteralPath $base -Recurse -Force -ErrorAction Stop)
        if ($entries.Count -lt 2 -or $entries.Count -gt 512) {
            throw 'Compiler module tree item count invalid.'
        }
        $records=New-Object 'System.Collections.Generic.List[string]'
        $total=[long]0
        $hasManifest=$false
        $hasModule=$false
        foreach($entry in @($entries | Sort-Object -Property FullName)) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                ($entry -isnot [IO.DirectoryInfo] -and $entry -isnot [IO.FileInfo])) {
                throw 'Redirected or unsupported compiler module member.'
            }
            $relative=$entry.FullName.Substring($base.Length+1).Replace('\','/')
            if ([string]::IsNullOrWhiteSpace($relative)) { throw 'Empty relative compiler path.' }
            $pathId=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($relative))
            if ($entry -is [IO.DirectoryInfo]) {
                $records.Add('D|'+$pathId)
            } else {
                if ($relative -ceq 'ps2exe.psd1') { $hasManifest=$true }
                if ($relative -ceq 'ps2exe.psm1') { $hasModule=$true }
                if ($entry.Length -lt 0) { throw 'Invalid module file length.' }
                $total += $entry.Length
                if ($total -gt 67108864L) { throw 'Compiler module tree too large.' }
                $fileSha=(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
                $records.Add('F|'+$pathId+'|'+$entry.Length+'|'+$fileSha)
            }
        }
        if (-not $hasManifest -or -not $hasModule) {
            throw 'Required PS2EXE compiler files missing.'
        }
        $sha=[Security.Cryptography.SHA256]::Create()
        try {
            $canonical=[string]::Join([char]10,$records.ToArray())
            $digest=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))).Replace('-','')
        } finally {
            $sha.Dispose()
        }
        return $digest
    } catch {
        throw 'N64 approved compiler module tree integrity blocked.'
    }
}

function Assert-N64CompilerModuleCopy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$SourceDirectory,
        [Parameter(Mandatory=$true)][string]$InstalledDirectory
    )
    try {
        $source=Get-N64CompilerModuleTreeDigest -ModuleDirectory $SourceDirectory
        $installed=Get-N64CompilerModuleTreeDigest -ModuleDirectory $InstalledDirectory
        if ($source -cne $installed) { throw 'Compiler copy differs from reviewed archive.' }
        return $installed
    } catch {
        throw 'N64 compiler module copy or continuity blocked.'
    }
}

function Assert-N64CompilerModuleContinuity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ModuleDirectory,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedSha256
    )
    try {
        if ($ExpectedSha256 -cnotmatch '\A[0-9a-fA-F]{64}\z') {
            throw 'Missing or malformed module tree approval.'
        }
        $actual=Get-N64CompilerModuleTreeDigest -ModuleDirectory $ModuleDirectory
        if ($actual -cne $ExpectedSha256.ToUpperInvariant()) {
            throw 'Protected module tree changed since installation.'
        }
        return $true
    } catch {
        throw 'N64 compiler module copy or continuity blocked.'
    }
}

Export-ModuleMember -Function Get-N64CompilerModuleTreeDigest,Assert-N64CompilerModuleCopy,Assert-N64CompilerModuleContinuity
