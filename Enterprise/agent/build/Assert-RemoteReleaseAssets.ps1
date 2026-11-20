#Requires -Version 5.1
# N60: read-only hosted asset verification across draft and public release.
# Drafts have a pending tag name but no remote Git tag; only a published
# release must be bound to an existing exact SHA-matched Git tag.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ArtifactDir,
    [Parameter(Mandatory=$true)][long]$ReleaseId,
    [switch]$RequireDraft,
    [switch]$RequirePublished
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
try {
    if ($env:OS -cne 'Windows_NT' -or
        ($RequireDraft.IsPresent -eq $RequirePublished.IsPresent) -or
        $ReleaseId -le 0 -or
        $env:GITHUB_ACTIONS -cne 'true' -or
        $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
        $env:GITHUB_REF -cne 'refs/heads/main' -or
        $env:GITHUB_REPOSITORY -cnotmatch '\A[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\z' -or
        $env:SOURCE_SHA -cnotmatch '\A[0-9a-f]{40}\z' -or
        [string]::IsNullOrWhiteSpace($env:GH_TOKEN) -or
        $env:APPROVED_MSI_SHA256 -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
        throw 'Unapproved protected publication context.'
    }
    $meta=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\agent-version.json') -Raw -ErrorAction Stop |
        ConvertFrom-Json -ErrorAction Stop
    $version=[string]$meta.agent_version
    $revision=[string]$meta.msi_revision
    $tag=('agent-v'+$version+'-r'+$revision)
    if ($env:RELEASE_TAG -cne $tag) {
        throw 'Release tag does not match signed source metadata.'
    }
    # Matching-refs returns a JSON array (including [] when no matching
    # tag exists), unlike the exact-ref endpoint which returns HTTP 404.
    # This avoids accidentally treating an auth/HTTP failure as no tag.
    $refsRaw=(& gh api ('repos/'+$env:GITHUB_REPOSITORY+'/git/matching-refs/tags/'+$tag) 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($refsRaw)) {
        throw 'Cannot authenticate expected Git tag state.'
    }
    Import-Module -Name (Join-Path $PSScriptRoot 'ReleaseTagLifecycle.psm1') -Force -ErrorAction Stop
    $tagParams=@{
        TagRefsJson=$refsRaw
        ExpectedTag=$tag
        ExpectedSourceSha=$env:SOURCE_SHA
    }
    if ($RequireDraft) {
        $null=Assert-N60ReleaseTagState @tagParams -RequireDraft
    } else {
        $null=Assert-N60ReleaseTagState @tagParams -RequirePublished
    }

    # REST GET /releases/tags/{tag} excludes draft releases. Bind the
    # precise ID returned by "gh release view --json databaseId" after
    # creation. All three checks use one immutable expected ID, not a
    # tag-based lookup that could resolve a different release later.
    $raw=(& gh api ('repos/'+$env:GITHUB_REPOSITORY+'/releases/'+$ReleaseId) 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
        throw 'GitHub Release by immutable ID unavailable.'
    }
    Import-Module -Name (Join-Path $PSScriptRoot 'ReleaseAssetAttestation.psm1') -Force -ErrorAction Stop
    $params=@{
        ArtifactDir=$ArtifactDir
        ExpectedTag=$tag
        ExpectedSourceSha=$env:SOURCE_SHA
        ExpectedReleaseId=$ReleaseId
        ExpectedVersion=$version
        ExpectedRevision=$revision
        ApprovedMsiSha256=$env:APPROVED_MSI_SHA256
        ReleaseJson=$raw
    }
    if ($RequireDraft) {
        $null=Assert-N59ReleaseAssetSet @params -RequireDraft
        Write-Host 'N60 protected draft ID, absent Git ref, and exact hosted asset SHA digests PASS.'
    } else {
        $null=Assert-N59ReleaseAssetSet @params -RequirePublished
        Write-Host 'N60 protected published release ID, Git source ref and hosted asset SHA digests PASS.'
    }
} catch {
    # Do not expose token, raw GitHub response or potentially untrusted tag.
    throw 'N60 remote release publication integrity blocked.'
}
