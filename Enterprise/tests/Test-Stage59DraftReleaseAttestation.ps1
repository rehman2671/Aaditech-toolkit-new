#Requires -Version 5.1
# N59 offline draft/public GitHub API SHA-256 verification regression.
# Uses only disposable synthetic bytes, no GitHub credentials or release.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N59 requires real Windows PowerShell.' }

$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$module=Join-Path $repo 'Enterprise\agent\build\ReleaseAssetAttestation.psm1'
$online=Join-Path $repo 'Enterprise\agent\build\Assert-RemoteReleaseAssets.ps1'
$workflow=Join-Path $repo '.github\workflows\publish-signed-installer.yml'
Import-Module -Name $module -Force -ErrorAction Stop
$ci=[IO.File]::ReadAllText($workflow)
$check=[IO.File]::ReadAllText($online)

$create=$ci.IndexOf('& gh release create',[StringComparison]::Ordinal)
$stage=$ci.IndexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequireDraft',[StringComparison]::Ordinal)
$lastStage=$ci.LastIndexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequireDraft',[StringComparison]::Ordinal)
$publish=$ci.IndexOf('& gh release edit',[StringComparison]::Ordinal)
$published=$ci.IndexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequirePublished',[StringComparison]::Ordinal)
$firstApproval=$ci.IndexOf('Assert-PublicationReviewerApproval.ps1',[StringComparison]::Ordinal)
$lastApproval=$ci.LastIndexOf('Assert-PublicationReviewerApproval.ps1',[StringComparison]::Ordinal)
if ($create -lt 0 -or $stage -le $create -or
    $lastStage -le $stage -or $publish -le $lastStage -or
    $published -le $publish -or
    $firstApproval -lt 0 -or $lastApproval -le $create -or
    $lastApproval -ge $publish -or
    $ci.IndexOf(' --draft --target $env:SOURCE_SHA',[StringComparison]::Ordinal) -lt 0 -or
    $ci.IndexOf('--draft=false --latest=false',[StringComparison]::Ordinal) -lt 0 -or
    $ci.IndexOf('cancel-in-progress: false',[StringComparison]::Ordinal) -lt 0 -or
    $ci.IndexOf('group: signed-windows-installer-',[StringComparison]::Ordinal) -lt 0 -or
    [regex]::Matches($ci,[regex]::Escape('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequireDraft')).Count -ne 2) {
    throw 'N59 unsigned/public release workflow ordering, staged SHA checks or concurrency missing.'
}
foreach ($marker in @('matching-refs/tags/', "'/releases/'", 'GITHUB_EVENT_NAME',
    'GITHUB_REF','SOURCE_SHA', 'APPROVED_MSI_SHA256',
    '-RequireDraft','-RequirePublished','ReleaseAssetAttestation.psm1')) {
    if ($check.IndexOf($marker,[StringComparison]::Ordinal) -lt 0) {
        throw ('N59 remote GitHub asset verifier missing: '+$marker)
    }
}

function Assert-N59Denied {
    param([scriptblock]$Action,[string]$Reason)
    $refused=$false
    try { $null=& $Action } catch {
        $refused=$true
        if ($_.Exception.Message -cne 'N59 GitHub Release asset integrity blocked.') {
            throw ('N59 leaked remote release details: '+$Reason)
        }
    }
    if (-not $refused) { throw ('N59 accepted unsafe draft/published asset: '+$Reason) }
}

$dir=Join-Path ([IO.Path]::GetTempPath()) ('n59-github-draft-'+[Guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($dir)
try {
    $version='1.3.7'
    $revision='2'
    $tag='agent-v1.3.7-r2'
    $source=('a'*40)
    $files=@(
        'IT-Toolkit-Agent.exe',
        'IT-Toolkit-Agent-1.3.7.msi',
        'SHA256SUMS.txt'
    )
    [IO.File]::WriteAllBytes((Join-Path $dir $files[0]),[Text.Encoding]::ASCII.GetBytes('N59 synthetic unsigned executable'))
    [IO.File]::WriteAllBytes((Join-Path $dir $files[1]),[Text.Encoding]::ASCII.GetBytes('N59 synthetic unsigned installer'))
    $exeHash=(Get-FileHash -LiteralPath (Join-Path $dir $files[0]) -Algorithm SHA256).Hash.ToLowerInvariant()
    $msiHash=(Get-FileHash -LiteralPath (Join-Path $dir $files[1]) -Algorithm SHA256).Hash.ToLowerInvariant()
    $lf=[string][char]10
    $canonical=$exeHash+'  '+$files[0]+$lf+$msiHash+'  '+$files[1]+$lf
    [IO.File]::WriteAllBytes((Join-Path $dir $files[2]),[Text.Encoding]::ASCII.GetBytes($canonical))
    $assets=@()
    for($i=0;$i -lt $files.Count;$i++){
        $path=Join-Path $dir $files[$i]
        $assets+=@{
            id=600+$i
            name=$files[$i]
            size=[long](Get-Item -LiteralPath $path).Length
            state='uploaded'
            digest=('sha256:'+(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant())
        }
    }
    $draft=@{
        id=42
        tag_name=$tag
        target_commitish=$source
        draft=$true
        prerelease=$false
        published_at=$null
        assets=$assets
    }
    $params=@{
        ArtifactDir=$dir
        ExpectedTag=$tag
        ExpectedSourceSha=$source
        ExpectedReleaseId=42
        ExpectedVersion=$version
        ExpectedRevision=$revision
        ApprovedMsiSha256=$msiHash.ToUpperInvariant()
        ReleaseJson=(ConvertTo-Json -InputObject $draft -Depth 12 -Compress)
    }
    if ((Assert-N59ReleaseAssetSet @params -RequireDraft) -ne $true) {
        throw 'N59 correct synthetic draft was not accepted.'
    }
    Assert-N59Denied -Reason 'published status cannot pass unpublished draft check' -Action {
        Assert-N59ReleaseAssetSet @params -RequirePublished
    }
    Assert-N59Denied -Reason 'missing required mode' -Action {
        Assert-N59ReleaseAssetSet @params
    }
    Assert-N59Denied -Reason 'both conflicting modes' -Action {
        Assert-N59ReleaseAssetSet @params -RequireDraft -RequirePublished
    }
    $publishedRelease=ConvertFrom-Json -InputObject $params.ReleaseJson
    $publishedRelease.draft=$false
    $publishedRelease.published_at='2026-11-20T12:00:00Z'
    $params.ReleaseJson=ConvertTo-Json -InputObject $publishedRelease -Depth 12 -Compress
    if ((Assert-N59ReleaseAssetSet @params -RequirePublished) -ne $true) {
        throw 'N59 expected synthetic completed publication not accepted.'
    }
    Assert-N59Denied -Reason 'published release cannot be treated as draft' -Action {
        Assert-N59ReleaseAssetSet @params -RequireDraft
    }
    # Keep immutable original fixture values. Every failure is tested
    # against a *distinct* synthetic API object; do not alter real releases.
    $original=ConvertTo-Json -InputObject $draft -Depth 12 -Compress
    foreach ($case in @(
        @{kind='missingEXE'; mutator={param($r)$r.assets=@($r.assets|Where-Object name -ne 'IT-Toolkit-Agent.exe')}},
        @{kind='emptyAssets';mutator={param($r)$r.assets=@()}},
        @{kind='unexpectedAsset';mutator={param($r)$r.assets[1].name='surprise.pfx'}},
        @{kind='duplicatedAsset';mutator={param($r)$r.assets[1].name='IT-Toolkit-Agent.exe'}},
        @{kind='wrongDigest';mutator={param($r)$r.assets[1].digest='sha256:'+('0'*64)}},
        @{kind='missingDigest';mutator={param($r)$r.assets[0].digest=$null}},
        @{kind='uppercaseDigest';mutator={param($r)$r.assets[0].digest='sha256:'+('A'*64)}},
        @{kind='wrongSize';mutator={param($r)$r.assets[1].size++}},
        @{kind='notUploaded';mutator={param($r)$r.assets[0].state='starter'}},
        @{kind='nullReleaseId';mutator={param($r)$r.id=0}},
        @{kind='wrongSource';mutator={param($r)$r.target_commitish='b'*40}},
        @{kind='wrongTag';mutator={param($r)$r.tag_name='agent-v1.3.7-r3'}},
        @{kind='prerelease';mutator={param($r)$r.prerelease=$true}},
        @{kind='invalidDraftTimestamp';mutator={param($r)$r.published_at='2026-11-20T12:00:00Z'}}
    )) {
        $object=ConvertFrom-Json -InputObject $original
        $null=& $case.mutator $object
        $params.ReleaseJson=ConvertTo-Json -InputObject $object -Depth 12 -Compress
        Assert-N59Denied -Reason $case.kind -Action {
            Assert-N59ReleaseAssetSet @params -RequireDraft
        }
    }
    $params.ReleaseJson=$original
    $params.ApprovedMsiSha256=('0'*64)
    Assert-N59Denied -Reason 'operator independently approved wrong MSI digest' -Action {
        Assert-N59ReleaseAssetSet @params -RequireDraft
    }
    $params.ApprovedMsiSha256=$msiHash
    [IO.File]::WriteAllBytes((Join-Path $dir $files[1]),[Text.Encoding]::ASCII.GetBytes('N59 installer changed after draft'))
    Assert-N59Denied -Reason 'local signed MSI changed after draft' -Action {
        Assert-N59ReleaseAssetSet @params -RequireDraft
    }
    [IO.File]::WriteAllBytes((Join-Path $dir $files[1]),[Text.Encoding]::ASCII.GetBytes('N59 synthetic unsigned installer'))
    [IO.File]::WriteAllBytes((Join-Path $dir $files[2]),[Text.Encoding]::ASCII.GetBytes($canonical+$canonical))
    Assert-N59Denied -Reason 'duplicate locally changed signed SHA256SUMS' -Action {
        Assert-N59ReleaseAssetSet @params -RequireDraft
    }
    Write-Host 'N59 PASS: draft assets/Git ref contract, exact 3 names, uploaded SHA-256 and size, independent MSI pin, published transition, local mutation and wrong remote metadata refused.'
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
