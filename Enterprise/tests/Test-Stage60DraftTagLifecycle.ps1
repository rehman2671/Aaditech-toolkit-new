#Requires -Version 5.1
# N60: synthetic offline draft-Git-ref / published-Git-ref lifecycle.
# Neither GitHub API, real signing keys nor customer endpoints contacted.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N60 requires Windows.' }
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module -Name (Join-Path $root 'Enterprise\agent\build\ReleaseTagLifecycle.psm1') -Force -ErrorAction Stop
$workflow=[IO.File]::ReadAllText((Join-Path $root '.github\workflows\publish-signed-installer.yml'))
$remote=[IO.File]::ReadAllText((Join-Path $root 'Enterprise\agent\build\Assert-RemoteReleaseAssets.ps1'))
$artifactModule=[IO.File]::ReadAllText((Join-Path $root 'Enterprise\agent\build\ReleaseAssetAttestation.psm1'))
$tag='agent-v1.1.2-r1'
$sha='a'*40
$params=@{
    ExpectedTag=$tag
    ExpectedSourceSha=$sha
}
function Assert-N60Denied([scriptblock]$Action,[string]$Case) {
    $caught=$false
    try { $null=& $Action } catch {
        $caught=$true
        if ($_.Exception.Message -cne 'N60 GitHub release tag provenance blocked.') {
            throw ('N60 exposed tag/reference data in '+$Case)
        }
    }
    if (-not $caught) { throw ('N60 accepted unsafe tag state: '+$Case) }
}

# Pending drafts exist by release database ID and have no Git ref.
if ((Assert-N60ReleaseTagState @params -TagRefsJson '[]' -RequireDraft) -ne $true) {
    throw 'N60 incorrectly rejects an untagged draft.'
}
Assert-N60Denied -Case 'prepublished tag missing' -Action {
    Assert-N60ReleaseTagState @params -TagRefsJson '[]' -RequirePublished
}

$good='[{"ref":"refs/tags/'+$tag+'","object":{"type":"commit","sha":"'+$sha+'"}}]'
if ((Assert-N60ReleaseTagState @params -TagRefsJson $good -RequirePublished) -ne $true) {
    throw 'N60 correctly published matching tag was refused.'
}
Assert-N60Denied -Case 'premature tag before draft publication' -Action {
    Assert-N60ReleaseTagState @params -TagRefsJson $good -RequireDraft
}
foreach ($bad in @(
    '[{"ref":"refs/tags/'+$tag+'","object":{"type":"commit","sha":"'+('b'*40)+'"}}]',
    '[{"ref":"refs/tags/'+$tag+'","object":{"type":"tag","sha":"'+$sha+'"}}]',
    $good.Substring(0,$good.Length-1)+','+$good.Substring(1),
    '{"ref":"refs/tags/'+$tag+'","object":{"type":"commit","sha":"'+$sha+'"}}',
    '[{"ref":"refs/tags/'+$tag+'","object":{"type":"commit","sha":null}}]',
    'not-json',
    '',
    '[null]',
    '[{"ref":"refs/tags/../../x","object":{"type":"commit","sha":"'+$sha+'"}}]'
)) {
    Assert-N60Denied -Case 'wrong tag SHA/annotated/duplicate/nonarray/bad JSON' -Action {
        Assert-N60ReleaseTagState @params -TagRefsJson $bad -RequirePublished
    }
}
$prefixOnly='[{"ref":"refs/tags/'+$tag+'-candidate","object":{"type":"commit","sha":"'+$sha+'"}}]'
if ((Assert-N60ReleaseTagState @params -TagRefsJson $prefixOnly -RequireDraft) -ne $true) {
    throw 'N60 mistook a different tag with shared prefix for exact draft tag.'
}
Assert-N60Denied -Case 'tag prefix is not an exact published tag' -Action {
    Assert-N60ReleaseTagState @params -TagRefsJson $prefixOnly -RequirePublished
}
Assert-N60Denied -Case 'no mode' -Action {
    Assert-N60ReleaseTagState @params -TagRefsJson '[]'
}
Assert-N60Denied -Case 'both conflicting modes' -Action {
    Assert-N60ReleaseTagState @params -TagRefsJson '[]' -RequireDraft -RequirePublished
}

# Static ordering guards against regression to the broken N59 draft path:
# no Git ref check that requires a tag during draft, and no draft access
# through GET /releases/tags/{tag}; use draft ID from "gh release view".
$create=$workflow.IndexOf('& gh release create',[StringComparison]::Ordinal)
$view=$workflow.IndexOf('gh release view $env:RELEASE_TAG --json databaseId,isDraft,tagName,targetCommitish',[StringComparison]::Ordinal)
$firstDraft=$workflow.IndexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequireDraft',[StringComparison]::Ordinal)
$lastDraft=$workflow.LastIndexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequireDraft',[StringComparison]::Ordinal)
$publish=$workflow.IndexOf('& gh release edit',[StringComparison]::Ordinal)
$published=$workflow.IndexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequirePublished',[StringComparison]::Ordinal)
$lastApproval=$workflow.LastIndexOf('Assert-PublicationReviewerApproval.ps1',[StringComparison]::Ordinal)
$lastPayload=$workflow.LastIndexOf('Verify-ReleaseArtifact.ps1',[StringComparison]::Ordinal)
if ($create -lt 0 -or $view -le $create -or
    $firstDraft -le $view -or $lastDraft -le $firstDraft -or
    $lastApproval -le $firstDraft -or $lastPayload -le $lastApproval -or
    $lastDraft -le $lastPayload -or $publish -le $lastDraft -or
    $published -le $publish -or
    [regex]::Matches($workflow,[regex]::Escape('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId')).Count -ne 3 -or
    $remote.IndexOf('matching-refs/tags/',[StringComparison]::Ordinal) -lt 0 -or
    $remote.IndexOf("'/releases/'",[StringComparison]::Ordinal) -lt 0 -or
    $remote.IndexOf('ExpectedReleaseId=$ReleaseId',[StringComparison]::Ordinal) -lt 0 -or
    $artifactModule.IndexOf('[long]$release.id -ne $ExpectedReleaseId',[StringComparison]::Ordinal) -lt 0 -or
    $remote.IndexOf("+'/releases/tags/'",[StringComparison]::Ordinal) -ge 0) {
    throw 'N60 immutable ID, draft tag absence, published SHA check or protected workflow order missing.'
}
Write-Host 'N60 PASS: untagged draft and exact published Git ref, source SHA, annotated/moved/ref duplicate denial, stable draft ID and reviewer rechecks all fail closed.'
exit 0
