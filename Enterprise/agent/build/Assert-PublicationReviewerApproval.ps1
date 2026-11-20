#Requires -Version 5.1
# N58 protected GitHub Release authorization, independent from the N56
# CI signing run. GITHUB_SHA is the *publication workflow* checkout SHA;
# SOURCE_SHA must instead be the human-approved successful signed CI run.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ArtifactDir,
    [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedSourceSha,
    [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ReleaseTag
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
try {
    if ($env:OS -cne 'Windows_NT' -or
        $env:GITHUB_ACTIONS -cne 'true' -or
        $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
        $env:GITHUB_REF -cne 'refs/heads/main' -or
        $ApprovedSourceSha -cnotmatch '\A[0-9a-f]{40}\z' -or
        $env:SOURCE_SHA -cne $ApprovedSourceSha -or
        $env:GITHUB_WORKSPACE -eq '') {
        throw 'Release dispatch and source identity invalid.'
    }
    $repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
    $actualSource=(& git -C $repoRoot rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or ([string]$actualSource).Trim() -cne $ApprovedSourceSha) {
        throw 'Downloaded source SHA does not match checked-out Git commit.'
    }
    $metadata=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\agent-version.json') -Raw |
        ConvertFrom-Json -ErrorAction Stop
    Import-Module -Name (Join-Path $PSScriptRoot 'ReleasePublicationApproval.psm1') -Force -ErrorAction Stop
    $params=@{
        ArtifactDir=$ArtifactDir
        ExpectedSourceSha=$ApprovedSourceSha
        ExpectedVersion=[string]$metadata.agent_version
        ExpectedRevision=[string]$metadata.msi_revision
        ExpectedReleaseTag=$ReleaseTag
        ExpectedPublisherThumbprint=[string]$env:CODESIGN_APPROVED_THUMBPRINT
        ExpectedSqliteArchiveSha256=[string]$env:SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED
        ExpectedSqliteExeSha256=[string]$env:SQLITE3_EXE_SHA256_APPROVED
        ManifestBase64=[string]$env:RELEASE_APPROVAL_MANIFEST_B64
        SignatureBase64=[string]$env:RELEASE_APPROVAL_SIGNATURE_B64
        ReviewerDerBase64=[string]$env:RELEASE_APPROVAL_REVIEWER_DER_B64
        ApprovedReviewerSha256=[string]$env:RELEASE_REVIEWER_CERT_SHA256_APPROVED
    }
    $null=Assert-N58SourceApproval @params
    Write-Host 'N58 signed CI source approval and GitHub Release tag matched.'
} catch {
    throw 'N58 protected GitHub Release authorization blocked.'
}
