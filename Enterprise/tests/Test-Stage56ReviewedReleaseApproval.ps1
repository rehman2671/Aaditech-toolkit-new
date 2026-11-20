#Requires -Version 5.1
# N56: throwaway reviewer RSA-2048 signed release scope. No actual PFX,
# customer DNS, live release approval, production keys or signing calls.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N56 requires Windows.' }

$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$module=Join-Path $root 'Enterprise\agent\build\ReviewedReleaseApproval.psm1'
$entry=Join-Path $root 'Enterprise\agent\build\Assert-ReleaseAuthorization.ps1'
$signer=Join-Path $root 'Enterprise\agent\build\Release-Sign.ps1'
$publisher=Join-Path $root 'Enterprise\agent\build\Verify-SignedPublication.ps1'
$workflow=Join-Path $root '.github\workflows\ci.yml'
Import-Module -Name $module -Force -ErrorAction Stop
$signSource=[IO.File]::ReadAllText($signer)
$pubSource=[IO.File]::ReadAllText($publisher)
$entrySource=[IO.File]::ReadAllText($entry)
$ci=[IO.File]::ReadAllText($workflow)
if ($signSource.IndexOf("StartSigning",[StringComparison]::Ordinal) -lt 0 -or
    $signSource.IndexOf("RequireOriginalDigest",[StringComparison]::Ordinal) -lt 0 -or
    $signSource.IndexOf("Flag 'RELEASE_APPROVAL_MANIFEST_SHA256'",[StringComparison]::Ordinal) -lt 0 -or
    [regex]::Matches($pubSource,'-RequireOriginalDigest').Count -ne 2 -or
    $pubSource.IndexOf('RELEASE_APPROVAL_MANIFEST_SHA256',[StringComparison]::Ordinal) -ge 0) {
    # Prepublication reads original digest via shared module to avoid
    # logging a hash and never creates/replaces the original digest.
    throw 'N56 two signing and final publication same-approval binding missing.'
}
if ($signSource.IndexOf('StartSigning',[StringComparison]::Ordinal) -gt
        $signSource.IndexOf('[IO.File]::WriteAllBytes($pfx',[StringComparison]::Ordinal) -or
    $pubSource.LastIndexOf('-RequireOriginalDigest',[StringComparison]::Ordinal) -gt
        $pubSource.IndexOf("'PUBLICATION_VERIFIED=true'",[StringComparison]::Ordinal)) {
    throw 'N56 signing scope or post-validation order incorrect.'
}
foreach ($required in @('GITHUB_SHA','agent-version.json','-ReturnManifestSha256',
    '-ExpectedManifestSha256','SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED',
    'SQLITE3_EXE_SHA256_APPROVED','CODESIGN_APPROVED_THUMBPRINT')) {
    if ($entrySource.IndexOf($required,[StringComparison]::Ordinal) -lt 0) {
        throw ('N56 signed release scope not bound: '+$required)
    }
}
foreach ($name in @('RELEASE_APPROVAL_MANIFEST_B64','RELEASE_APPROVAL_SIGNATURE_B64',
    'RELEASE_APPROVAL_REVIEWER_DER_B64','RELEASE_REVIEWER_CERT_SHA256_APPROVED')) {
    if ([regex]::Matches($ci,[regex]::Escape($name+':')).Count -ne 4) {
        throw ('N56 protected reviewer secret not scoped to all three gates: '+$name)
    }
}
function Assert-N56Denied {
    param([scriptblock]$Action,[string]$Case)
    $blocked=$false
    try { $null = & $Action } catch {
        $blocked=$true
        if ($_.Exception.Message -cne 'N56 independently signed release approval blocked.') {
            throw 'N56 leaked unredacted reviewer or scope information.'
        }
    }
    if (-not $blocked) { throw ('N56 wrongly accepted '+$Case) }
}
$git=('a'*40)
$publisherHash=('B'*40)
$zip=('C'*64)
$exe=('D'*64)
$format="yyyy-MM-dd'T'HH:mm:ss'Z'"
$issued=[DateTime]::UtcNow.AddMinutes(-2)
$expires=[DateTime]::UtcNow.AddMinutes(60)
$lf=[string][char]10
function New-N56Manifest {
    param([string]$ApprovalId,[string]$GitSha=$git,
        [string]$PublisherHash=$publisherHash,[string]$ZipSha=$zip,
        [string]$ExeSha=$exe,[string]$Version='1.1.2',
        [string]$Revision='1',[DateTime]$Issue=$issued,
        [DateTime]$Expiry=$expires)
    return ((@(
        'AADITECH-MSI-RELEASE-V1',
        ('git_sha='+$GitSha),
        ('agent_version='+$Version),
        ('msi_revision='+$Revision),
        ('publisher_thumbprint='+$PublisherHash),
        ('sqlite_archive_sha256='+$ZipSha),
        ('sqlite_exe_sha256='+$ExeSha),
        ('issued_utc='+$Issue.ToUniversalTime().ToString($format)),
        ('expires_utc='+$Expiry.ToUniversalTime().ToString($format)),
        ('approval_id='+$ApprovalId)
    ) -join $lf)+$lf)
}
$rsa=$null
$cert=$null
$hash=$null
try {
    $rsa=[Security.Cryptography.RSACng]::new(2048)
    $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=Aaditech N56 synthetic release reviewer',$rsa,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),
        [DateTimeOffset]::UtcNow.AddDays(2))
    $der=$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $hash=[Security.Cryptography.SHA256]::Create()
    $reviewerHash=[BitConverter]::ToString($hash.ComputeHash($der)).Replace('-','')
    $check=@{
        ManifestBase64=''
        SignatureBase64=''
        ReviewerDerBase64=[Convert]::ToBase64String($der)
        ApprovedReviewerSha256=$reviewerHash
        ExpectedGitSha=$git
        ExpectedAgentVersion='1.1.2'
        ExpectedMsiRevision='1'
        ExpectedPublisherThumbprint=$publisherHash
        ExpectedSqliteArchiveSha256=$zip
        ExpectedSqliteExeSha256=$exe
    }
    function Set-N56SignedRecord([string]$Content) {
        $bytes=[Text.Encoding]::ASCII.GetBytes($Content)
        $signature=$rsa.SignData($bytes,
            [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $check.ManifestBase64=[Convert]::ToBase64String($bytes)
        $check.SignatureBase64=[Convert]::ToBase64String($signature)
        return [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','')
    }
    $original=New-N56Manifest -ApprovalId 'N56-review-original-2026'
    $digest=Set-N56SignedRecord $original
    if ((Assert-N56ReviewedRelease @check -ReturnManifestSha256) -cne $digest -or
        (Assert-N56ReviewedRelease @check -ExpectedManifestSha256 $digest) -ne $true -or
        (Assert-N56ReviewedRelease @check -ExpectedManifestSha256 $digest.ToLowerInvariant()) -ne $true) {
        throw 'N56 original reviewer-signed canonical release scope not accepted.'
    }
    foreach ($bad in @('', ('0'*64), ('z'*64))) {
        Assert-N56Denied -Case 'missing/changed original approval identity' -Action {
            Assert-N56ReviewedRelease @check -ExpectedManifestSha256 $bad
        }
    }
    $null=Set-N56SignedRecord (New-N56Manifest -ApprovalId 'N56-review-replaced-2026')
    if ((Assert-N56ReviewedRelease @check) -ne $true) {
        throw 'N56 negative fixture independently signed replacement must otherwise verify.'
    }
    Assert-N56Denied -Case 'new valid signed record during same release' -Action {
        Assert-N56ReviewedRelease @check -ExpectedManifestSha256 $digest
    }
    foreach ($variation in @(
        (New-N56Manifest -ApprovalId 'N56-review-original-2026' -GitSha ('b'*40)),
        (New-N56Manifest -ApprovalId 'N56-review-original-2026' -PublisherHash ('E'*40)),
        (New-N56Manifest -ApprovalId 'N56-review-original-2026' -ZipSha ('F'*64)),
        (New-N56Manifest -ApprovalId 'N56-review-original-2026' -ExeSha ('0'*64)),
        (New-N56Manifest -ApprovalId 'N56-review-original-2026' -Version '1.1.3'),
        (New-N56Manifest -ApprovalId 'N56-review-original-2026' -Revision '2'),
        (New-N56Manifest -ApprovalId 'N56-review-original-2026' -Issue ([DateTime]::UtcNow.AddHours(-3)) -Expiry ([DateTime]::UtcNow.AddMinutes(-3))),
        ($original.Replace($lf,([string][char]13+$lf))),
        ($original+$lf)
    )) {
        $null=Set-N56SignedRecord $variation
        Assert-N56Denied -Case 'valid reviewer signature for wrong/expired/noncanonical source or pin' -Action {
            Assert-N56ReviewedRelease @check
        }
    }
    $null=Set-N56SignedRecord $original
    $saved=$check.SignatureBase64
    $signatureBytes=[Convert]::FromBase64String($saved)
    $signatureBytes[0]=$signatureBytes[0] -bxor 1
    $check.SignatureBase64=[Convert]::ToBase64String($signatureBytes)
    Assert-N56Denied -Case 'tampered detached RSA signature' -Action {
        Assert-N56ReviewedRelease @check
    }
    $check.SignatureBase64=$saved
    $check.ApprovedReviewerSha256=('0'*64)
    Assert-N56Denied -Case 'unapproved reviewer public DER fingerprint' -Action {
        Assert-N56ReviewedRelease @check
    }
    $check.ApprovedReviewerSha256=$reviewerHash
    $check.ManifestBase64='***not-base64***'
    Assert-N56Denied -Case 'malformed base64 approval' -Action {
        Assert-N56ReviewedRelease @check
    }

    # Exercise the actual shared three-stage wrapper on disposable synthetic
    # environment values; never invoke Release-Sign.ps1 or touch any real PFX.
    $null=Set-N56SignedRecord $original
    $environmentNames=@(
        'GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_SHA',
        'CODESIGN_APPROVED_THUMBPRINT','SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED',
        'SQLITE3_EXE_SHA256_APPROVED','RELEASE_APPROVAL_MANIFEST_B64',
        'RELEASE_APPROVAL_SIGNATURE_B64','RELEASE_APPROVAL_REVIEWER_DER_B64',
        'RELEASE_REVIEWER_CERT_SHA256_APPROVED','RELEASE_APPROVAL_MANIFEST_SHA256'
    )
    $previous=@{}
    foreach ($key in $environmentNames) {
        $previous[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
    }
    try {
        $synthetic=@{
            GITHUB_ACTIONS='true'
            GITHUB_EVENT_NAME='workflow_dispatch'
            GITHUB_REF='refs/heads/main'
            GITHUB_SHA=$git
            CODESIGN_APPROVED_THUMBPRINT=$publisherHash
            SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED=$zip
            SQLITE3_EXE_SHA256_APPROVED=$exe
            RELEASE_APPROVAL_MANIFEST_B64=$check.ManifestBase64
            RELEASE_APPROVAL_SIGNATURE_B64=$check.SignatureBase64
            RELEASE_APPROVAL_REVIEWER_DER_B64=$check.ReviewerDerBase64
            RELEASE_REVIEWER_CERT_SHA256_APPROVED=$reviewerHash
            RELEASE_APPROVAL_MANIFEST_SHA256=$digest
        }
        foreach ($key in $synthetic.Keys) {
            [Environment]::SetEnvironmentVariable($key,$synthetic[$key],'Process')
        }
        $fromWrapper=(& $entry -StartSigning)
        if ($fromWrapper -cne $digest -or (& $entry -RequireOriginalDigest) -ne $true) {
            throw 'N56 synthetic wrapper did not authenticate same signing scope.'
        }
        [Environment]::SetEnvironmentVariable('GITHUB_SHA',('f'*40),'Process')
        $wrapperBlocked=$false
        try { $null= & $entry -RequireOriginalDigest } catch {
            $wrapperBlocked=($_.Exception.Message -ceq 'N56 reviewed production release authorization blocked.')
        }
        if (-not $wrapperBlocked) {
            throw 'N56 actual wrapper accepted different Git SHA for approved release.'
        }
        [Environment]::SetEnvironmentVariable('GITHUB_SHA',$git,'Process')
        [Environment]::SetEnvironmentVariable('GITHUB_EVENT_NAME','push','Process')
        $wrapperBlocked=$false
        try { $null= & $entry -StartSigning } catch {
            $wrapperBlocked=($_.Exception.Message -ceq 'N56 reviewed production release authorization blocked.')
        }
        if (-not $wrapperBlocked) { throw 'N56 wrapper accepted non-manual signing.' }
    } finally {
        foreach ($key in $environmentNames) {
            [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process')
        }
    }

    Write-Host 'N56 PASS: reviewer RSA-2048 signed exact Git/version/revision/publisher/SQLite, expiry, identity rotation, signature and DER pin fail-closed offline.'
} finally {
    if ($null -ne $hash) { $hash.Dispose() }
    if ($null -ne $cert) { $cert.Dispose() }
    if ($null -ne $rsa) { $rsa.Dispose() }
}
exit 0
