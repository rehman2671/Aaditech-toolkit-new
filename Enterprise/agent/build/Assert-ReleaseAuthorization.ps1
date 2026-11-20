#Requires -Version 5.1
# N56: common signed release authorization for PrePackage, Finalize, and
# pre-upload. No network, no private reviewer keys, no false approvals.
[CmdletBinding()]
param(
    [switch]$StartSigning,
    [switch]$RequireOriginalDigest
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if (($StartSigning -and $RequireOriginalDigest) -or
    (-not $StartSigning -and -not $RequireOriginalDigest) -or
    $env:GITHUB_ACTIONS -cne 'true' -or
    $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
    $env:GITHUB_REF -cne 'refs/heads/main' -or
    $env:GITHUB_SHA -cnotmatch '\A[0-9a-f]{40}\z') {
    throw 'N56 reviewed production release authorization blocked.'
}
try {
    Import-Module -Name (Join-Path $PSScriptRoot 'ReviewedReleaseApproval.psm1') -Force -ErrorAction Stop
    $metadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\agent-version.json') -Raw -ErrorAction Stop |
        ConvertFrom-Json -ErrorAction Stop
    $params = @{
        ManifestBase64 = [string]$env:RELEASE_APPROVAL_MANIFEST_B64
        SignatureBase64 = [string]$env:RELEASE_APPROVAL_SIGNATURE_B64
        ReviewerDerBase64 = [string]$env:RELEASE_APPROVAL_REVIEWER_DER_B64
        ApprovedReviewerSha256 = [string]$env:RELEASE_REVIEWER_CERT_SHA256_APPROVED
        ExpectedGitSha = [string]$env:GITHUB_SHA
        ExpectedAgentVersion = [string]$metadata.agent_version
        ExpectedMsiRevision = [string]$metadata.msi_revision
        ExpectedPublisherThumbprint = [string]$env:CODESIGN_APPROVED_THUMBPRINT
        ExpectedSqliteArchiveSha256 = [string]$env:SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED
        ExpectedSqliteExeSha256 = [string]$env:SQLITE3_EXE_SHA256_APPROVED
    }
    if ($StartSigning) {
        return (Assert-N56ReviewedRelease @params -ReturnManifestSha256)
    }
    # N56 must re-authenticate the exact first signed reviewer record;
    # switching to another valid reviewer signature midway is still blocked.
    $null = Assert-N56ReviewedRelease @params -ExpectedManifestSha256 $env:RELEASE_APPROVAL_MANIFEST_SHA256
    return $true
} catch {
    throw 'N56 reviewed production release authorization blocked.'
}
