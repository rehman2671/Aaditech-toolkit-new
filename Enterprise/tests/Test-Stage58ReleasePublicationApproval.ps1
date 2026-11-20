#Requires -Version 5.1
# N58: disposable synthetic EXE/MSI/checksums and throwaway reviewer RSA.
# No publisher PFX, signing, live server or GitHub release publication.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N58 requires Windows.' }
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$module=Join-Path $root 'Enterprise\agent\build\ReleasePublicationApproval.psm1'
$sourceReceiptScript=Join-Path $root 'Enterprise\agent\build\Write-SourceReleaseApprovalReceipt.ps1'
$publishScript=Join-Path $root 'Enterprise\agent\build\Assert-PublicationReviewerApproval.ps1'
$verifyScript=Join-Path $root 'Enterprise\agent\build\Verify-ReleaseArtifact.ps1'
$ciFile=Join-Path $root '.github\workflows\ci.yml'
$releaseFile=Join-Path $root '.github\workflows\publish-signed-installer.yml'
Import-Module -Name $module -Force -ErrorAction Stop

$ci=[IO.File]::ReadAllText($ciFile)
$release=[IO.File]::ReadAllText($releaseFile)
$sourceReceipt=[IO.File]::ReadAllText($sourceReceiptScript)
$publisher=[IO.File]::ReadAllText($publishScript)
$verify=[IO.File]::ReadAllText($verifyScript)
foreach ($marker in @('RELEASE_SIGNING_ENABLED', 'PUBLICATION_VERIFIED',
    'Assert-ReleaseAuthorization.ps1', 'RELEASE_APPROVAL_MANIFEST_SHA256',
    'RELEASE_APPROVAL_RECEIPT_VERIFIED=true')) {
    if ($sourceReceipt.IndexOf($marker,[StringComparison]::Ordinal) -lt 0) {
        throw ('N58 source approval receipt missing: '+$marker)
    }
}
foreach ($marker in @('GITHUB_EVENT_NAME', 'refs/heads/main','SOURCE_SHA',
    'git -C $repoRoot rev-parse HEAD','Assert-N58SourceApproval')) {
    if ($publisher.IndexOf($marker,[StringComparison]::Ordinal) -lt 0) {
        throw ('N58 protected release source identity missing: '+$marker)
    }
}
foreach ($marker in @('Assert-N55SignedPublicationManifest','Assert-N54ApprovedSqliteFile',
    'ApprovedSqliteExeSha256','embeddedConfig.needs_setup -ne $true',
    'embeddedConfig.bootstrap_token')) {
    if ($verify.IndexOf($marker,[StringComparison]::Ordinal) -lt 0) {
        throw ('N58 release payload verifier missing: '+$marker)
    }
}
$verifyStart=$release.IndexOf('N58 verify same signed source reviewer approval',[StringComparison]::Ordinal)
$artifactCheck=$release.IndexOf('Verify version and exact trusted EXE/MSI publisher',[StringComparison]::Ordinal)
$lastApproval=$release.LastIndexOf('Assert-PublicationReviewerApproval.ps1',[StringComparison]::Ordinal)
$lastPayload=$release.LastIndexOf('Verify-ReleaseArtifact.ps1',[StringComparison]::Ordinal)
$create=$release.IndexOf('gh release create',[StringComparison]::Ordinal)
$upload=$ci.IndexOf('Upload verified signed artifacts only',[StringComparison]::Ordinal)
$receiptStep=$ci.IndexOf('N58 record final verified source reviewer approval identity',[StringComparison]::Ordinal)
if ($verifyStart -lt 0 -or $artifactCheck -le $verifyStart -or
    $lastApproval -le $artifactCheck -or $lastPayload -le $lastApproval -or
    $create -le $lastPayload -or $receiptStep -lt 0 -or $upload -le $receiptStep -or
    $ci.IndexOf("env.RELEASE_APPROVAL_RECEIPT_VERIFIED == 'true'",[StringComparison]::Ordinal) -lt 0 -or
    [regex]::Matches($release,'Assert-PublicationReviewerApproval.ps1').Count -ne 2 -or
    $release.IndexOf('$assets.Count -ne 3',[StringComparison]::Ordinal) -lt 0) {
    throw 'N58 protected GitHub Release and source CI step ordering bypassed.'
}
foreach ($marker in @('workflow_dispatch','head_repository.full_name',
    'source.head_sha','source.path','approved_source_sha','approved_msi_sha256',
    'RELEASE_APPROVAL_MANIFEST_B64','RELEASE_APPROVAL_SIGNATURE_B64',
    'RELEASE_APPROVAL_REVIEWER_DER_B64','RELEASE_REVIEWER_CERT_SHA256_APPROVED',
    'SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED','SQLITE3_EXE_SHA256_APPROVED')) {
    if ($release.IndexOf($marker,[StringComparison]::Ordinal) -lt 0) {
        throw ('N58 publisher lacks independently approved provenance: '+$marker)
    }
}
if ($release.IndexOf('RELEASE-APPROVAL-SHA256.txt',[StringComparison]::Ordinal) -ge 0 -or
    $ci.IndexOf('Enterprise/agent/build/out/RELEASE-APPROVAL-SHA256.txt',[StringComparison]::Ordinal) -lt 0) {
    # Receipt stays INSIDE CI artifact, never in the publicly advertised
    # EXE/MSI/SHA256SUMS release asset listing.
    throw 'N58 receipt must stay only in the private source artifact.'
}
function Assert-N58Denied([scriptblock]$Action,[string]$Case) {
    $blocked=$false
    try { $null=& $Action } catch {
        $blocked=$true
        if ($_.Exception.Message -cne 'N58 signed release publication approval blocked.') {
            throw ('N58 leaked failure details for '+$Case)
        }
    }
    if (-not $blocked) { throw ('N58 accepted '+$Case) }
}
$tmp=Join-Path ([IO.Path]::GetTempPath()) ('n58-source-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($tmp)
$rsa=$null
$cert=$null
$hasher=$null
try {
    $version='1.1.2'
    $revision='1'
    $source=('a'*40)
    $publisherPin=('B'*40)
    $zipPin=('C'*64)
    $sqlitePin=('D'*64)
    $exePath=Join-Path $tmp 'IT-Toolkit-Agent.exe'
    $msiPath=Join-Path $tmp 'IT-Toolkit-Agent-1.1.2.msi'
    $shaPath=Join-Path $tmp 'SHA256SUMS.txt'
    $configPath=Join-Path $tmp 'agent-config.json'
    $receiptPath=Join-Path $tmp 'RELEASE-APPROVAL-SHA256.txt'
    [IO.File]::WriteAllBytes($exePath,[Text.Encoding]::ASCII.GetBytes('N58 synthetic EXE'))
    [IO.File]::WriteAllBytes($msiPath,[Text.Encoding]::ASCII.GetBytes('N58 synthetic MSI'))
    $hasher=[Security.Cryptography.SHA256]::Create()
    function Get-N58Digest([byte[]]$Bytes) {
        return [BitConverter]::ToString($hasher.ComputeHash($Bytes)).Replace('-','')
    }
    $exeHash=(Get-N58Digest ([IO.File]::ReadAllBytes($exePath))).ToLowerInvariant()
    $msiHash=(Get-N58Digest ([IO.File]::ReadAllBytes($msiPath))).ToLowerInvariant()
    $lf=[string][char]10
    $originalShaText=$exeHash+'  IT-Toolkit-Agent.exe'+$lf+
        $msiHash+'  IT-Toolkit-Agent-1.1.2.msi'+$lf
    [IO.File]::WriteAllBytes($shaPath,[Text.Encoding]::ASCII.GetBytes($originalShaText))
    $blankConfig='{"needs_setup":true,"endpoint":"","enroll_url":"","token":"","bootstrap_token":""}'
    [IO.File]::WriteAllBytes($configPath,[Text.Encoding]::ASCII.GetBytes($blankConfig))
    $rsa=[Security.Cryptography.RSACng]::new(2048)
    $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=Aaditech N58 synthetic release reviewer',$rsa,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),
        [DateTimeOffset]::UtcNow.AddDays(2))
    $der=$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $format="yyyy-MM-dd'T'HH:mm:ss'Z'"
    $issue=[DateTime]::UtcNow.AddMinutes(-2).ToString($format)
    $expiry=[DateTime]::UtcNow.AddMinutes(75).ToString($format)
    $scope=@(
        'AADITECH-MSI-RELEASE-V1',
        ('git_sha='+$source),
        ('agent_version='+$version),
        ('msi_revision='+$revision),
        ('publisher_thumbprint='+$publisherPin),
        ('sqlite_archive_sha256='+$zipPin),
        ('sqlite_exe_sha256='+$sqlitePin),
        ('issued_utc='+$issue),
        ('expires_utc='+$expiry),
        'approval_id=N58-original-approval'
    )
    function Set-N58ReviewerManifest([string]$ApprovalId) {
        $body=(@($scope[0..8])+@('approval_id='+$ApprovalId)) -join $lf
        $bytes=[Text.Encoding]::ASCII.GetBytes($body+$lf)
        $sig=$rsa.SignData($bytes,
            [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $params.ManifestBase64=[Convert]::ToBase64String($bytes)
        $params.SignatureBase64=[Convert]::ToBase64String($sig)
        return (Get-N58Digest $bytes)
    }
    $params=@{
        ArtifactDir=$tmp
        ExpectedSourceSha=$source
        ExpectedVersion=$version
        ExpectedRevision=$revision
        ExpectedReleaseTag='agent-v1.1.2-r1'
        ExpectedPublisherThumbprint=$publisherPin
        ExpectedSqliteArchiveSha256=$zipPin
        ExpectedSqliteExeSha256=$sqlitePin
        ManifestBase64=''
        SignatureBase64=''
        ReviewerDerBase64=[Convert]::ToBase64String($der)
        ApprovedReviewerSha256=(Get-N58Digest $der)
    }
    $initial=Set-N58ReviewerManifest 'N58-original-approval'
    [IO.File]::WriteAllBytes($receiptPath,[Text.Encoding]::ASCII.GetBytes($initial+$lf))
    if ((Assert-N58SourceApproval @params) -ne $true) {
        throw 'N58 original reviewer signed release approval was not accepted.'
    }
    $null=Set-N58ReviewerManifest 'N58-rotated-approval'
    Assert-N58Denied -Case 'different validly signed reviewer record after source CI' -Action {
        Assert-N58SourceApproval @params
    }
    $null=Set-N58ReviewerManifest 'N58-original-approval'
    foreach ($change in @(
        @{ExpectedSourceSha=('b'*40)},
        @{ExpectedVersion='1.1.3'},
        @{ExpectedRevision='2'},
        @{ExpectedReleaseTag='agent-v1.1.2-r2'},
        @{ExpectedPublisherThumbprint=('F'*40)},
        @{ExpectedSqliteArchiveSha256=('E'*64)},
        @{ExpectedSqliteExeSha256=('0'*64)},
        @{ApprovedReviewerSha256=('0'*64)}
    )) {
        $modified=$params.Clone()
        foreach ($key in $change.Keys) { $modified[$key]=$change[$key] }
        Assert-N58Denied -Case 'mismatched Git version revision publisher dependency or reviewer' -Action {
            Assert-N58SourceApproval @modified
        }
    }
    foreach ($bad in @('', ('0'*64)+$lf, $initial, $initial+[string][char]13+$lf,
            $initial.ToLowerInvariant()+$lf, $initial+$lf+$lf)) {
        [IO.File]::WriteAllBytes($receiptPath,[Text.Encoding]::ASCII.GetBytes($bad))
        Assert-N58Denied -Case 'bad or missing non-secret exact approval receipt' -Action {
            Assert-N58SourceApproval @params
        }
    }
    [IO.File]::WriteAllBytes($receiptPath,[Text.Encoding]::ASCII.GetBytes($initial+$lf))
    [IO.File]::WriteAllBytes($configPath,[Text.Encoding]::ASCII.GetBytes(
        '{"needs_setup":true,"endpoint":"https://unauthorized.invalid","enroll_url":"","token":"","bootstrap_token":""}'))
    Assert-N58Denied -Case 'provisioned server template' -Action {
        Assert-N58SourceApproval @params
    }
    [IO.File]::WriteAllBytes($configPath,[Text.Encoding]::ASCII.GetBytes($blankConfig))
    $extra=Join-Path $tmp 'unexpected.pfx'
    [IO.File]::WriteAllBytes($extra,[Text.Encoding]::ASCII.GetBytes('not permitted'))
    Assert-N58Denied -Case 'extra unapproved release contents' -Action {
        Assert-N58SourceApproval @params
    }
    Remove-Item -LiteralPath $extra -Force
    [IO.File]::WriteAllBytes($exePath,[Text.Encoding]::ASCII.GetBytes('N58 mutated EXE'))
    Assert-N58Denied -Case 'changed MSI publication EXE bytes' -Action {
        Assert-N58SourceApproval @params
    }
    [IO.File]::WriteAllBytes($exePath,[Text.Encoding]::ASCII.GetBytes('N58 synthetic EXE'))
    [IO.File]::WriteAllBytes($shaPath,[Text.Encoding]::ASCII.GetBytes(
        $originalShaText+$originalShaText))
    Assert-N58Denied -Case 'duplicate SHA256SUMS lines' -Action {
        Assert-N58SourceApproval @params
    }
    Write-Host 'N58 PASS: original signed receipt, source/version/pins, rotation, extra assets, canonical hashes and customer identity all fail-closed offline.'
} finally {
    if ($null -ne $hasher) { $hasher.Dispose() }
    if ($null -ne $cert) { $cert.Dispose() }
    if ($null -ne $rsa) { $rsa.Dispose() }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
