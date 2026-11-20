#Requires -Version 5.1
# N51: offline throwaway RSA reviewer signature and manifest fault injection.
# NO customer DNS, HTTP, live operator consent, or real reviewer approval.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N51 requires Windows.' }

$moduleFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\WindowsCurlSignedApproval.psm1'))
$operatorFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
$source = [IO.File]::ReadAllText($moduleFile)
$operator = [IO.File]::ReadAllText($operatorFile)
foreach ($bad in @('GetHostAddresses','Invoke-RestMethod',
    'Invoke-WebRequest','TcpClient','curl.exe','Start-Process','PrivateKey')) {
    if ($source.IndexOf($bad,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'N51 reviewer approval module unexpectedly performs network or private-key activity.'
    }
}
$approvalCall='Assert-PublicWindowsCurlSignedApproval -ManifestPath'
if ($operator.IndexOf($approvalCall,[StringComparison]::Ordinal) -lt 0 -or
    $operator.IndexOf('$workspace = New-PrivateWindowsProbeWorkspace',
        [StringComparison]::Ordinal) -le
        $operator.IndexOf($approvalCall,[StringComparison]::Ordinal) -or
    $operator.IndexOf('[System.Net.Dns]::GetHostAddresses',
        [StringComparison]::Ordinal) -le
        $operator.IndexOf($approvalCall,[StringComparison]::Ordinal)) {
    throw 'N51 reviewer approval must precede native curl and customer DNS.'
}
Import-Module -Name $moduleFile -Force -ErrorAction Stop

$origin='https://fleet.syntheticvendor.tld'
$signer='A'*64
$binary='B'*64
$lf=[string][char]10
$crlf=([string][char]13)+$lf
$now=[DateTime]::UtcNow
$issued=$now.AddMinutes(-5)
$expires=$now.AddHours(3)
function New-N51Text {
    param([DateTime]$Issued,[DateTime]$Expires,
          [string]$ChosenOrigin='https://fleet.syntheticvendor.tld',
          [string]$ChosenSigner=('A'*64),
          [string]$ChosenBinary=('B'*64),
          [string]$ApprovalId='n51-synthetic-approval')
    $lf=[string][char]10
    $format="yyyy-MM-dd'T'HH:mm:ss'Z'"
    return ((@(
        'AADITECH-CURL-APPROVAL-V1',
        ('origin='+$ChosenOrigin),
        ('signer_cert_sha256='+$ChosenSigner),
        ('curl_binary_sha256='+$ChosenBinary),
        ('issued_utc='+$Issued.ToUniversalTime().ToString($format)),
        ('expires_utc='+$Expires.ToUniversalTime().ToString($format)),
        ('approval_id='+$ApprovalId)
    ) -join $lf)+$lf)
}
function Assert-N51Reject {
    param([scriptblock]$Action,[string]$Reason)
    $refused=$false
    try { $null=& $Action } catch {
        $refused=$true
        if ($_.Exception.Message -cne 'Windows curl approval manifest blocked.') {
            throw 'N51 refusal disclosed path, certificate or manifest.'
        }
    }
    if (-not $refused) { throw ('N51 wrongly accepted: '+$Reason) }
}

$valid=New-N51Text -Issued $issued -Expires $expires
if ((Assert-PublicWindowsCurlApprovalContent -Content $valid -ExpectedOrigin $origin -ExpectedSignerSha256 $signer -ExpectedBinarySha256 $binary) -ne $true) {
    throw 'N51 refused a valid canonical approval.'
}
foreach ($item in @(
    @{reason='changed origin';v=(New-N51Text -Issued $issued -Expires $expires -ChosenOrigin 'https://other.syntheticvendor.tld')},
    @{reason='changed signer';v=(New-N51Text -Issued $issued -Expires $expires -ChosenSigner ('C'*64))},
    @{reason='changed binary';v=(New-N51Text -Issued $issued -Expires $expires -ChosenBinary ('D'*64))},
    @{reason='duplicate field';v=($valid.Replace('signer_cert_sha256=',('origin='+$origin+$lf+'signer_cert_sha256=')))},
    @{reason='unknown field';v=($valid.Replace('approval_id=','unknown_key='))},
    @{reason='extra newline';v=($valid+$lf)},
    @{reason='missing LF terminator';v=$valid.TrimEnd([char]10)},
    @{reason='CRLF not canonical';v=$valid.Replace($lf,$crlf)},
    @{reason='expired';v=(New-N51Text -Issued $now.AddHours(-3) -Expires $now.AddSeconds(-1))},
    @{reason='future issuance';v=(New-N51Text -Issued $now.AddHours(1) -Expires $now.AddHours(2))},
    @{reason='over 24-hour lifetime';v=(New-N51Text -Issued $issued -Expires $issued.AddHours(25))},
    @{reason='invalid ID';v=(New-N51Text -Issued $issued -Expires $expires -ApprovalId 'bad!')}
)) {
    $candidate=[string]$item.v
    Assert-N51Reject -Reason $item.reason -Action {
        Assert-PublicWindowsCurlApprovalContent -Content $candidate -ExpectedOrigin $origin -ExpectedSignerSha256 $signer -ExpectedBinarySha256 $binary
    }
}

$root=Join-Path ([IO.Path]::GetTempPath()) ('n51-offline-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($root)
$rsa=$null
$cert=$null
$hash=$null
try {
    # Windows CNG supports explicit 2048-bit key creation on both
    # .NET Framework/Windows PowerShell 5.1 and modern PowerShell 7.
    $rsa=[Security.Cryptography.RSACng]::new(2048)
    $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=Aaditech N51 synthetic CI reviewer',$rsa,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),
        [DateTimeOffset]::UtcNow.AddDays(2))
    $certBytes=$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $hash=[Security.Cryptography.SHA256]::Create()
    $reviewerHash=[BitConverter]::ToString($hash.ComputeHash($certBytes)).Replace('-','')
    $data=[Text.Encoding]::ASCII.GetBytes($valid)
    $signature=$rsa.SignData($data,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $manifest=Join-Path $root 'approval.txt'
    $signatureFile=Join-Path $root 'approval.sig'
    $reviewer=Join-Path $root 'reviewer.der'
    [IO.File]::WriteAllBytes($manifest,$data)
    [IO.File]::WriteAllBytes($signatureFile,$signature)
    [IO.File]::WriteAllBytes($reviewer,$certBytes)
    $check=@{
        ManifestPath=$manifest
        SignaturePath=$signatureFile
        ReviewerCertificatePath=$reviewer
        ApprovedReviewerCertificateSha256=$reviewerHash
        ExpectedOrigin=$origin
        ExpectedSignerSha256=$signer
        ExpectedBinarySha256=$binary
    }
    if ((Assert-PublicWindowsCurlSignedApproval @check) -ne $true) {
        throw 'N51 valid temporary RSA reviewer signature refused.'
    }
    $check.ApprovedReviewerCertificateSha256=$reviewerHash.ToLowerInvariant()
    if ((Assert-PublicWindowsCurlSignedApproval @check) -ne $true) {
        throw 'N51 reviewer SHA-256 lowercase refused.'
    }
    $check.ApprovedReviewerCertificateSha256='0'*64
    Assert-N51Reject -Reason 'unapproved reviewer DER digest' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    $check.ApprovedReviewerCertificateSha256=$reviewerHash
    $check.ExpectedOrigin='https://changed.syntheticvendor.tld'
    Assert-N51Reject -Reason 'approved origin does not match' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    $check.ExpectedOrigin=$origin
    $check.ExpectedBinarySha256='C'*64
    Assert-N51Reject -Reason 'approved binary pin differs' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    $check.ExpectedBinarySha256=$binary

    $changed=[Text.Encoding]::ASCII.GetBytes(
        $valid.Replace('n51-synthetic-approval','n51-synthetic-mutated1'))
    [IO.File]::WriteAllBytes($manifest,$changed)
    Assert-N51Reject -Reason 'signed approval contents changed' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    [IO.File]::WriteAllBytes($manifest,$data)
    $badSig=[byte[]]$signature.Clone()
    $badSig[0]=$badSig[0] -bxor 1
    [IO.File]::WriteAllBytes($signatureFile,$badSig)
    Assert-N51Reject -Reason 'RSA signature tamper' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    [IO.File]::WriteAllBytes($signatureFile,$signature)
    $bom=[byte[]](@(239,187,191)+@($data))
    [IO.File]::WriteAllBytes($manifest,$bom)
    Assert-N51Reject -Reason 'BOM and non-ASCII byte order' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    [IO.File]::WriteAllBytes($manifest,$data)
    $check.ApprovedReviewerCertificateSha256=''
    Assert-N51Reject -Reason 'missing independently reviewed key pin' -Action {
        Assert-PublicWindowsCurlSignedApproval @check
    }
    $check.ApprovedReviewerCertificateSha256=$reviewerHash
    if ((Assert-PublicWindowsCurlSignedApproval @check) -ne $true) {
        throw 'N51 final clean signature did not recover.'
    }
    Write-Host 'N51 PASS: offline canonical origin/two hashes, 24h approval and RSA reviewer signature with negative faults. No customer network.'
} finally {
    if ($null -ne $cert) { $cert.Dispose() }
    if ($null -ne $rsa) { $rsa.Dispose() }
    if ($null -ne $hash) { $hash.Dispose() }
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
