#Requires -Version 5.1
# N59: purely offline GitHub Release API asset digest attestation.
# Does not create releases, fetch network resources or handle signing keys.
Set-StrictMode -Version Latest

function Assert-N59ReleaseAssetSet {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ArtifactDir,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedTag,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedSourceSha,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedVersion,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedRevision,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedMsiSha256,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ReleaseJson,
        [switch]$RequireDraft,
        [switch]$RequirePublished
    )
    try {
        if ($env:OS -cne 'Windows_NT' -or
            ($RequireDraft.IsPresent -eq $RequirePublished.IsPresent) -or
            $ExpectedSourceSha -cnotmatch '\A[0-9a-f]{40}\z' -or
            $ExpectedVersion -cnotmatch '\A(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,3})\z' -or
            $ExpectedRevision -cnotmatch '\A(?:[1-9]|[1-9][0-9]{1,2})\z' -or
            $ExpectedTag -cne ('agent-v'+$ExpectedVersion+'-r'+$ExpectedRevision) -or
            $ApprovedMsiSha256 -cnotmatch '\A[0-9a-fA-F]{64}\z' -or
            [string]::IsNullOrWhiteSpace($ReleaseJson) -or
            $ReleaseJson.Length -gt 262144) {
            throw 'Invalid release scope or mode.'
        }
        $release=ConvertFrom-Json -InputObject $ReleaseJson -ErrorAction Stop
        if ($null -eq $release -or
            [string]$release.tag_name -cne $ExpectedTag -or
            [string]$release.target_commitish -cne $ExpectedSourceSha -or
            $release.prerelease -ne $false -or
            [long]$release.id -le 0) {
            throw 'Unexpected release source, tag or state.'
        }
        if ($RequireDraft) {
            if ($release.draft -ne $true -or $null -ne $release.published_at) {
                throw 'Assets must be attested before public publication.'
            }
        } elseif ($RequirePublished) {
            if ($release.draft -ne $false -or
                [string]::IsNullOrWhiteSpace([string]$release.published_at)) {
                throw 'Release is not actually published.'
            }
        }

        # N55 independently verifies the exact two-line canonical SHA256SUMS
        # and the EXE/MSI hashes. N59 then binds those same local bytes to
        # the hashes reported by GitHub for every uploaded asset.
        Import-Module -Name (Join-Path $PSScriptRoot 'ReleaseArtifactManifest.psm1') -Force -ErrorAction Stop
        $root=[IO.Path]::GetFullPath($ArtifactDir)
        $null=Assert-N55SignedPublicationManifest -OutputDirectory $root -ExpectedAgentVersion $ExpectedVersion

        $expectedNames=@('IT-Toolkit-Agent.exe',
            ('IT-Toolkit-Agent-'+$ExpectedVersion+'.msi'), 'SHA256SUMS.txt')
        $assets=@($release.assets)
        if ($assets.Count -ne 3) {
            throw 'Release must contain exactly three uploaded assets.'
        }
        $seen=@{}
        foreach ($asset in $assets) {
            $name=[string]$asset.name
            if ($name -cnotin $expectedNames -or $seen.ContainsKey($name) -or
                [string]$asset.state -cne 'uploaded' -or
                [string]$asset.digest -cnotmatch '\Asha256:[0-9a-f]{64}\z' -or
                [long]$asset.size -lt 1 -or
                [long]$asset.id -le 0) {
                throw 'Uploaded release asset name, digest or state invalid.'
            }
            $seen[$name]=$true
            $local=Get-Item -LiteralPath (Join-Path $root $name) -Force -ErrorAction Stop
            if ($local -isnot [IO.FileInfo] -or
                ($local.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                $local.Length -ne [long]$asset.size) {
                throw 'Uploaded release asset size differs from verified local bytes.'
            }
            $localHash=(Get-FileHash -LiteralPath $local.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            if ([string]$asset.digest -cne ('sha256:'+$localHash)) {
                throw 'GitHub-hosted release asset digest differs from signed bytes.'
            }
            if ($name -ceq ('IT-Toolkit-Agent-'+$ExpectedVersion+'.msi') -and
                $localHash -cne $ApprovedMsiSha256.ToLowerInvariant()) {
                throw 'Published MSI does not match independent operator approval.'
            }
        }
        if ($seen.Count -ne 3) { throw 'Release assets incomplete.' }
        return $true
    } catch {
        # Never expose approval digest, release API response, source paths or
        # potential customer machine details in Action failure messages.
        throw 'N59 GitHub Release asset integrity blocked.'
    }
}

Export-ModuleMember -Function Assert-N59ReleaseAssetSet
