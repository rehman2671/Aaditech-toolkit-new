#Requires -Version 5.1
# N52: offline regression for signed-approval rechecks surrounding customer DNS
# and live HTTPS. Uses a throwaway RSA key only; no external network.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N52 requires Windows.' }

$scriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
$modulePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\deploy\WindowsCurlSignedApproval.psm1'))
$operator = [IO.File]::ReadAllText($scriptPath)
$call = 'Assert-PublicWindowsCurlSignedApproval -ManifestPath'
if ([regex]::Matches($operator,[regex]::Escape($call)).Count -ne 4) {
    throw 'N52 requires initial, pre-DNS, pre-transfer, and post-transfer signature checks.'
}
$markers = @(
    "VERIFY_SIGNED_APPROVAL",
    "RECHECK_SIGNED_APPROVAL_PRE_DNS",
    '[System.Net.Dns]::GetHostAddresses',
    "RECHECK_SIGNED_APPROVAL_PRE_TRANSFER",
    '$httpStatus = @(& $curl @curlArguments',
    "RECHECK_SIGNED_APPROVAL_POST_TRANSFER",
    "Assert-PublicWindowsPinnedHealthResult",
    '$state = ''PASS'''
)
$last = -1
foreach ($marker in $markers) {
    $at = $operator.IndexOf($marker,[StringComparison]::Ordinal)
    if ($at -le $last) { throw ('N52 misplaced revalidation point: '+$marker) }
    $last = $at
}
Import-Module -Name $modulePath -Force -ErrorAction Stop

$origin='https://synthetic-n52.example.net'
$signer='A'*64
$binary='B'*64
$now=[DateTime]::UtcNow
$format="yyyy-MM-dd'T'HH:mm:ss'Z'"
$lf=[string][char]10
function New-N52Manifest {
    param([DateTime]$Issued,[DateTime]$Expires,[string]$Id='n52-synthetic-approval')
    return ((@(
        'AADITECH-CURL-APPROVAL-V1',
        ('origin='+$origin),
        ('signer_cert_sha256='+$signer),
        ('curl_binary_sha256='+$binary),
        ('issued_utc='+$Issued.ToUniversalTime().ToString($format)),
        ('expires_utc='+$Expires.ToUniversalTime().ToString($format)),
        ('approval_id='+$Id)
    ) -join $lf)+$lf)
}
function Assert-N52Blocked {
    param([scriptblock]$Action,[string]$Case)
    $blocked=$false
    try { $null=& $Action } catch {
        $blocked=$true
        if ($_.Exception.Message -cne 'Windows curl approval manifest blocked.') {
            throw 'N52 denial leaked unredacted approval data.'
        }
    }
    if (-not $blocked) { throw ('N52 erroneously accepted '+$Case) }
}

$root=Join-Path ([IO.Path]::GetTempPath()) ('n52-offline-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($root)
$rsa=$null
$cert=$null
$sha=$null
try {
    $rsa=[Security.Cryptography.RSACng]::new(2048)
    $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=Aaditech N52 synthetic reviewer',$rsa,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),
        [DateTimeOffset]::UtcNow.AddDays(2))
    $certBytes=$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $sha=[Security.Cryptography.SHA256]::Create()
    $fingerprint=[BitConverter]::ToString($sha.ComputeHash($certBytes)).Replace('-','')
    $manifestPath=Join-Path $root 'approval.txt'
    $signaturePath=Join-Path $root 'approval.sig'
    $certificatePath=Join-Path $root 'reviewer.der'
    [IO.File]::WriteAllBytes($certificatePath,$certBytes)
    $valid=[Text.Encoding]::ASCII.GetBytes((New-N52Manifest -Issued $now.AddMinutes(-1) -Expires $now.AddMinutes(20)))
    $validSig=$rsa.SignData($valid,[Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    [IO.File]::WriteAllBytes($manifestPath,$valid)
    [IO.File]::WriteAllBytes($signaturePath,$validSig)
    $check=@{
        ManifestPath=$manifestPath
        SignaturePath=$signaturePath
        ReviewerCertificatePath=$certificatePath
        ApprovedReviewerCertificateSha256=$fingerprint
        ExpectedOrigin=$origin
        ExpectedSignerSha256=$signer
        ExpectedBinarySha256=$binary
    }
    # Four successive read/verify invocations model the live code's gates;
    # they never invoke OS DNS, curl or a customer health endpoint.
    if ((Assert-PublicWindowsCurlSignedApproval @check) -ne $true) {
        throw 'N52 initial synthetic approval was rejected.'
    }
    if ((Assert-PublicWindowsCurlSignedApproval @check) -ne $true) {
        throw 'N52 pre-DNS revalidation was rejected.'
    }
    # Emulate a local on-disk edit *after* initial approval.
    $changed=[Text.Encoding]::ASCII.GetBytes(
        (New-N52Manifest -Issued $now.AddMinutes(-1) -Expires $now.AddMinutes(20) -Id 'n52-synthetic-tampered'))
    [IO.File]::WriteAllBytes($manifestPath,$changed)
    Assert-N52Blocked -Case 'changed approval before transfer' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    [IO.File]::WriteAllBytes($manifestPath,$valid)
    # An approval can be authentically signed and STILL be expired. Rechecks
    # must honor wall-clock validity, not cache initial signature success.
    $expired=[Text.Encoding]::ASCII.GetBytes(
        (New-N52Manifest -Issued $now.AddHours(-2) -Expires $now.AddMinutes(-1)))
    $expiredSig=$rsa.SignData($expired,[Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    [IO.File]::WriteAllBytes($manifestPath,$expired)
    [IO.File]::WriteAllBytes($signaturePath,$expiredSig)
    Assert-N52Blocked -Case 'signed but expired approval at pre-transfer gate' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    [IO.File]::WriteAllBytes($manifestPath,$valid)
    [IO.File]::WriteAllBytes($signaturePath,$validSig)
    if ((Assert-PublicWindowsCurlSignedApproval @check) -ne $true) {
        throw 'N52 clean pre-transfer revalidation did not recover.'
    }
    $badSig=[byte[]]$validSig.Clone()
    $badSig[0]=$badSig[0] -bxor 1
    [IO.File]::WriteAllBytes($signaturePath,$badSig)
    Assert-N52Blocked -Case 'signature replacement during transfer' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    [IO.File]::WriteAllBytes($signaturePath,$validSig)
    if ((Assert-PublicWindowsCurlSignedApproval @check) -ne $true) {
        throw 'N52 post-transfer revalidation did not recover.'
    }
    Write-Host 'N52 PASS: four ordered approval gates; offline changed/expired/tampered signatures denied.'
} finally {
    if ($null -ne $sha) { $sha.Dispose() }
    if ($null -ne $cert) { $cert.Dispose() }
    if ($null -ne $rsa) { $rsa.Dispose() }
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
