#Requires -Version 5.1
# N66: bind the protected WiX global-tool shim and all installed NuGet tool
# store bytes to the N63 SHA-approved, local-feed restore. Reattest BEFORE
# the build invokes any WiX executable; a version string is not identity.
# This is installed-tree continuity, not independent source provenance.
Set-StrictMode -Version Latest

function Get-N66WixToolFingerprint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ToolRoot,
        [Parameter(Mandatory=$true)][string]$ToolVersion
    )
    try {
        if ($env:OS -cne 'Windows_NT' -or
            $ToolVersion -cnotmatch '\A(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\z') {
            throw 'Unsupported tool identity.'
        }
        # NuGet global tool: %USERPROFILE%\.dotnet\tools\wix.exe and
        # tools\.store\wix\<version> are two parts of one executable.
        $root=Get-Item -LiteralPath $ToolRoot -Force -ErrorAction Stop
        if ($root -isnot [IO.DirectoryInfo] -or
            ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Unsafe global tool root.'
        }
        $base=[IO.Path]::GetFullPath($root.FullName).TrimEnd([char[]]@('\','/'))
        $storeParent=Join-Path $base '.store'
        $packageParent=Join-Path $storeParent 'wix'
        $store=Join-Path $packageParent $ToolVersion
        foreach ($directory in @($storeParent,$packageParent,$store)) {
            $member=Get-Item -LiteralPath $directory -Force -ErrorAction Stop
            if ($member -isnot [IO.DirectoryInfo] -or
                ($member.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Redirected or absent WiX tool store directory.'
            }
        }
        $shimPath=Join-Path $base 'wix.exe'
        $shim=Get-Item -LiteralPath $shimPath -Force -ErrorAction Stop
        if ($shim -isnot [IO.FileInfo] -or
            ($shim.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $shim.Length -lt 1 -or $shim.Length -gt 16777216L) {
            throw 'Untrusted WiX shim.'
        }
        $entries=@(Get-ChildItem -LiteralPath $store -Recurse -Force -ErrorAction Stop)
        if ($entries.Count -lt 1 -or $entries.Count -gt 8192) {
            throw 'WiX tool store entry count invalid.'
        }
        $records=New-Object 'System.Collections.Generic.List[string]'
        $total=[long]0
        $files=0
        $storeFull=[IO.Path]::GetFullPath($store).TrimEnd([char[]]@('\','/'))
        foreach ($entry in @($entries | Sort-Object -Property FullName)) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                ($entry -isnot [IO.DirectoryInfo] -and $entry -isnot [IO.FileInfo])) {
                throw 'Redirected WiX tool member.'
            }
            $relative=$entry.FullName.Substring($storeFull.Length+1).Replace('\','/')
            if ([string]::IsNullOrWhiteSpace($relative)) { throw 'Invalid WiX tool relative path.' }
            $identifier=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($relative))
            if ($entry -is [IO.DirectoryInfo]) {
                $records.Add('D|'+$identifier)
            } else {
                if ($entry.Length -lt 0 -or $entry.Length -gt 268435456L) {
                    throw 'Invalid WiX tool file size.'
                }
                $files++
                $total += $entry.Length
                if ($total -gt 805306368L) { throw 'WiX tool store too large.' }
                $fileSha=(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
                $records.Add('F|'+$identifier+'|'+$entry.Length+'|'+$fileSha)
            }
        }
        if ($files -lt 1) { throw 'Empty WiX tool store.' }
        $sha=[Security.Cryptography.SHA256]::Create()
        try {
            $canonical=[string]::Join([char]10,$records.ToArray())
            $storeSha=[BitConverter]::ToString(
                $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))
            ).Replace('-','')
        } finally {
            $sha.Dispose()
        }
        $shimSha=(Get-FileHash -LiteralPath $shim.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
        return [pscustomobject]@{
            StoreSha256=$storeSha
            ShimSha256=$shimSha
        }
    } catch {
        # Do not reveal runner paths, package metadata or signed release scope.
        throw 'N66 protected WiX tool fingerprint blocked.'
    }
}

function Assert-N66WixToolContinuity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ToolRoot,
        [Parameter(Mandatory=$true)][string]$ToolVersion,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ResolvedCommand,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedStoreSha256,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedShimSha256
    )
    try {
        if ($ExpectedStoreSha256 -cnotmatch '\A[0-9a-fA-F]{64}\z' -or
            $ExpectedShimSha256 -cnotmatch '\A[0-9a-fA-F]{64}\z' -or
            [string]::IsNullOrWhiteSpace($ResolvedCommand)) {
            throw 'Unstamped or malformed tool identity.'
        }
        $expectedShim=[IO.Path]::GetFullPath((Join-Path $ToolRoot 'wix.exe'))
        if ([IO.Path]::GetFullPath($ResolvedCommand) -ne $expectedShim) {
            throw 'PATH-selected WiX executable differs from vetted global tool.'
        }
        $fingerprint=Get-N66WixToolFingerprint -ToolRoot $ToolRoot -ToolVersion $ToolVersion
        if ($fingerprint.StoreSha256 -cne $ExpectedStoreSha256.ToUpperInvariant() -or
            $fingerprint.ShimSha256 -cne $ExpectedShimSha256.ToUpperInvariant()) {
            throw 'Installed WiX tool changed after approved local restore.'
        }
        return $true
    } catch {
        throw 'N66 protected WiX tool continuity blocked.'
    }
}

Export-ModuleMember -Function Get-N66WixToolFingerprint,Assert-N66WixToolContinuity
