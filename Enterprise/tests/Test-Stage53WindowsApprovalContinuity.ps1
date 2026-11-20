#Requires -Version 5.1
# N53: offline exact signed approval record continuity across four live gates.
# Synthetic reviewer key only; NO customer DNS, HTTP, native curl or production approval.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N53 requires Windows.' }

$module = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\deploy\WindowsCurlSignedApproval.psm1'))
$operator = [IO.File]::ReadAllText([IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1')))
$call = 'Assert-PublicWindowsCurlSignedApproval -ManifestPath'
if ([regex]::Matches($operator,[regex]::Escape($call)).Count -ne 4 -or
    [regex]::Matches($operator,[regex]::Escape('-ExpectedManifestSha256 $approvalManifestSha256')).Count -ne 3 -or
    [regex]::Matches($operator,[regex]::Escape('-ReturnManifestSha256')).Count -ne 1) {
    throw 'N53 initial manifest digest must be bound to all three follow-on gates.'
}
$initial = $operator.IndexOf('$approvalManifestSha256 = '+$call,[StringComparison]::Ordinal)
$preDns = $operator.IndexOf("RECHECK_SIGNED_APPROVAL_PRE_DNS",[StringComparison]::Ordinal)
$preTransfer = $operator.IndexOf("RECHECK_SIGNED_APPROVAL_PRE_TRANSFER",[StringComparison]::Ordinal)
$postTransfer = $operator.IndexOf("RECHECK_SIGNED_APPROVAL_POST_TRANSFER",[StringComparison]::Ordinal)
$pass = $operator.IndexOf('$state = ' + "'PASS'",[StringComparison]::Ordinal)
if ($initial -lt 0 -or $initial -ge $preDns -or $preDns -ge $preTransfer -or
    $preTransfer -ge $postTransfer -or $postTransfer -ge $pass) {
    throw 'N53 approval binding is not ordered before network and result acceptance.'
}
Import-Module -Name $module -Force -ErrorAction Stop

$origin='https://n53.syntheticvendor.tld'
$signer='A'*64
$binary='B'*64
$lf=[string][char]10
$timestampFormat="yyyy-MM-dd'T'HH:mm:ss'Z'"
$issued=[DateTime]::UtcNow.AddMinutes(-2)
$expires=[DateTime]::UtcNow.AddMinutes(30)
function New-N53Approval {
    param([string]$Id)
    return ((@(
        'AADITECH-CURL-APPROVAL-V1',
        ('origin='+$origin),
        ('signer_cert_sha256='+$signer),
        ('curl_binary_sha256='+$binary),
        ('issued_utc='+$issued.ToUniversalTime().ToString($timestampFormat)),
        ('expires_utc='+$expires.ToUniversalTime().ToString($timestampFormat)),
        ('approval_id='+$Id)
    ) -join $lf)+$lf)
}
function Assert-N53Rejected {
    param([scriptblock]$Action,[string]$Case)
    $blocked=$false
    try { $null = & $Action } catch {
        $blocked=$true
        if ($_.Exception.Message -cne 'Windows curl approval manifest blocked.') {
            throw 'N53 leaked unredacted approval data.'
        }
    }
    if (-not $blocked) { throw ('N53 wrongly accepted '+$Case) }
}

$dir=Join-Path ([IO.Path]::GetTempPath()) ('n53-offline-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($dir)
$rsa=$null
$cert=$null
$hash=$null
try {
    $rsa=[Security.Cryptography.RSACng]::new(2048)
    $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=Aaditech N53 synthetic reviewer',$rsa,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),
        [DateTimeOffset]::UtcNow.AddDays(2))
    $der=$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $hash=[Security.Cryptography.SHA256]::Create()
    $reviewerHash=[BitConverter]::ToString($hash.ComputeHash($der)).Replace('-','')
    $manifestPath=Join-Path $dir 'approval.txt'
    $signaturePath=Join-Path $dir 'approval.sig'
    $certificatePath=Join-Path $dir 'reviewer.der'
    [IO.File]::WriteAllBytes($certificatePath,$der)

    $original=[Text.Encoding]::ASCII.GetBytes((New-N53Approval -Id 'n53-review-original'))
    $originalSignature=$rsa.SignData($original,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    [IO.File]::WriteAllBytes($manifestPath,$original)
    [IO.File]::WriteAllBytes($signaturePath,$originalSignature)
    $check=@{
        ManifestPath=$manifestPath
        SignaturePath=$signaturePath
        ReviewerCertificatePath=$certificatePath
        ApprovedReviewerCertificateSha256=$reviewerHash
        ExpectedOrigin=$origin
        ExpectedSignerSha256=$signer
        ExpectedBinarySha256=$binary
    }
    $record=(Assert-PublicWindowsCurlSignedApproval @check -ReturnManifestSha256)
    $actual=[BitConverter]::ToString($hash.ComputeHash($original)).Replace('-','')
    if ($record -cne $actual -or $record -cnotmatch '\A[0-9A-F]{64}\z') {
        throw 'N53 initial manifest hash is not exact canonical bytes.'
    }
    if ((Assert-PublicWindowsCurlSignedApproval @check -ExpectedManifestSha256 $record) -ne $true -or
        (Assert-PublicWindowsCurlSignedApproval @check -ExpectedManifestSha256 $record.ToLowerInvariant()) -ne $true) {
        throw 'N53 original signed record should pass repeated verification.'
    }
    foreach ($bad in @('', ('C' * 64), 'not-a-sha256')) {
        Assert-N53Rejected -Case 'missing/wrong initial manifest pin' -Action {
            Assert-PublicWindowsCurlSignedApproval @check -ExpectedManifestSha256 $bad
        }
    }

    # Same reviewer key, origin, curl signer and curl binary: all N51 checks
    # would pass this distinct approval, but N53 must reject a mid-run swap.
    $replacement=[Text.Encoding]::ASCII.GetBytes(
        (New-N53Approval -Id 'n53-review-replaced'))
    $replacementSignature=$rsa.SignData($replacement,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    [IO.File]::WriteAllBytes($manifestPath,$replacement)
    [IO.File]::WriteAllBytes($signaturePath,$replacementSignature)
    if ((Assert-PublicWindowsCurlSignedApproval @check) -ne $true) {
        throw 'N53 negative fixture was not independently validly signed.'
    }
    Assert-N53Rejected -Case 'fresh valid reviewer-signed replacement' -Action {
        Assert-PublicWindowsCurlSignedApproval @check -ExpectedManifestSha256 $record
    }
    [IO.File]::WriteAllBytes($manifestPath,$original)
    [IO.File]::WriteAllBytes($signaturePath,$originalSignature)
    if ((Assert-PublicWindowsCurlSignedApproval @check -ExpectedManifestSha256 $record) -ne $true) {
        throw 'N53 restoring exact original approval must recover.'
    }
    # Temporal expiry is always evaluated again, even for the same bytes:
    # a valid record digest must not extend authorization lifetime.
    $expired=[Text.Encoding]::ASCII.GetBytes(
        (@(
            'AADITECH-CURL-APPROVAL-V1',
            ('origin='+$origin),
            ('signer_cert_sha256='+$signer),
            ('curl_binary_sha256='+$binary),
            ('issued_utc='+[DateTime]::UtcNow.AddHours(-2).ToString($timestampFormat)),
            ('expires_utc='+[DateTime]::UtcNow.AddMinutes(-1).ToString($timestampFormat)),
            'approval_id=n53-review-expired'
        ) -join $lf)+$lf)
    $expiredSignature=$rsa.SignData($expired,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    [IO.File]::WriteAllBytes($manifestPath,$expired)
    [IO.File]::WriteAllBytes($signaturePath,$expiredSignature)
    Assert-N53Rejected -Case 'valid signature but expired record' -Action {
        Assert-PublicWindowsCurlSignedApproval @check -ReturnManifestSha256
    }
    Write-Host 'N53 PASS: 4 gates bind one exact signed record; validly signed replacement, malformed pins and expiry blocked offline.'
} finally {
    if ($null -ne $hash) { $hash.Dispose() }
    if ($null -ne $cert) { $cert.Dispose() }
    if ($null -ne $rsa) { $rsa.Dispose() }
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
