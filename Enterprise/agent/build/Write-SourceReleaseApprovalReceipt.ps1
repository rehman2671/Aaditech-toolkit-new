#Requires -Version 5.1
# N58: record ONLY the non-secret SHA256 of the independently signed N56
# approval after N55's protected final signer/payload gate succeeded.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
try {
    if ($env:GITHUB_ACTIONS -cne 'true' -or
        $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
        $env:GITHUB_REF -cne 'refs/heads/main' -or
        $env:RELEASE_SIGNING_ENABLED -cne 'true' -or
        $env:PUBLISH_SIGNED -cne 'true' -or
        $env:PUBLICATION_VERIFIED -cne 'true' -or
        [string]::IsNullOrWhiteSpace($env:GITHUB_ENV) -or
        $env:RELEASE_APPROVAL_MANIFEST_SHA256 -cnotmatch '\A[A-F0-9]{64}\z') {
        throw 'Unapproved signing context.'
    }
    # The initial reviewer record is checked again immediately before its
    # digest is written; this file is NOT itself an approval.
    $null = & (Join-Path $PSScriptRoot 'Assert-ReleaseAuthorization.ps1') -RequireOriginalDigest
    $out=Join-Path $PSScriptRoot 'out'
    $file=Join-Path $out 'RELEASE-APPROVAL-SHA256.txt'
    if (Test-Path -LiteralPath $file) {
        throw 'Existing approval receipt must never be silently replaced.'
    }
    [IO.File]::WriteAllBytes($file,
        [Text.Encoding]::ASCII.GetBytes($env:RELEASE_APPROVAL_MANIFEST_SHA256+[string][char]10))
    'RELEASE_APPROVAL_RECEIPT_VERIFIED=true' |
        Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8
    Write-Host 'N58 signed-source reviewer approval receipt securely staged.'
} catch {
    throw 'N58 signed-source approval receipt blocked.'
}
