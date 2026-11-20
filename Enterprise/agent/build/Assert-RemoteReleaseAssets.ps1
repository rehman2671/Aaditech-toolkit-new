#Requires -Version 5.1
# N59: protected remote asset attestation around draft->published boundary.
# This script never uploads, edits, deletes tags or creates a release.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ArtifactDir,
    [switch]$RequireDraft,
    [switch]$RequirePublished
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
try {
    if ($env:OS -cne 'Windows_NT' -or
        ($RequireDraft.IsPresent -eq $RequirePublished.IsPresent) -or
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
    # Require the Git ref itself to be a lightweight tag pointing at the
    # exact human-approved SHA, not just an API release object's target.
    $refRaw=(& gh api ('repos/'+$env:GITHUB_REPOSITORY+'/git/ref/tags/'+$tag) 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($refRaw)) {
        throw 'Cannot authenticate signed source tag reference.'
    }
    $tagRef=ConvertFrom-Json -InputObject $refRaw -ErrorAction Stop
    if ([string]$tagRef.ref -cne ('refs/tags/'+$tag) -or
        [string]$tagRef.object.type -cne 'commit' -or
        [string]$tagRef.object.sha -cne $env:SOURCE_SHA) {
        throw 'Remote release tag is not pinned to approved source commit.'
    }

    $raw=(& gh api ('repos/'+$env:GITHUB_REPOSITORY+'/releases/tags/'+$tag) 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
        throw 'GitHub Release asset status unavailable.'
    }
    Import-Module -Name (Join-Path $PSScriptRoot 'ReleaseAssetAttestation.psm1') -Force -ErrorAction Stop
    $params=@{
        ArtifactDir=$ArtifactDir
        ExpectedTag=$tag
        ExpectedSourceSha=$env:SOURCE_SHA
        ExpectedVersion=$version
        ExpectedRevision=$revision
        ApprovedMsiSha256=$env:APPROVED_MSI_SHA256
        ReleaseJson=$raw
    }
    if ($RequireDraft) {
        $null=Assert-N59ReleaseAssetSet @params -RequireDraft
        Write-Host 'N59 protected unpublished draft assets match signed local bytes.'
    } else {
        $null=Assert-N59ReleaseAssetSet @params -RequirePublished
        Write-Host 'N59 published release assets match signed local bytes.'
    }
} catch {
    throw 'N59 remote release publication integrity blocked.'
}
