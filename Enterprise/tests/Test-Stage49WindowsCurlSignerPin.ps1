#Requires -Version 5.1
# N49 strict local certificate pin regression on Windows PowerShell 5.1/7.
# No approved application hostname, no DNS, telemetry, HTTPS GET, or customer
# acceptance. The local signer digest below is a CI fixture, NOT an
# independently approved Microsoft signing certificate fingerprint.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N49 test requires Windows.' }

$moduleFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\TrustedWindowsSystemCurl.psm1'))
$probeFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
$source = [IO.File]::ReadAllText($moduleFile)
$probeSource = [IO.File]::ReadAllText($probeFile)
foreach ($forbidden in @('GetHostAddresses','Invoke-RestMethod',
    'Invoke-WebRequest','TcpClient','--insecure','--proxy','--location')) {
    if ($source.IndexOf($forbidden,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'N49 pure Windows signer module unexpectedly uses network capabilities.'
    }
}
$pinRequired = '$ApprovedCurlSignerSha256 -cnotmatch'
$approvedParameter = '-ApprovedSignerSha256 $ApprovedCurlSignerSha256'
$dns = '[System.Net.Dns]::GetHostAddresses'
$trusted = '$curl = Assert-PublicWindowsTrustedSystemCurl'
if ($probeSource.IndexOf($pinRequired,[StringComparison]::Ordinal) -lt 0 -or
    $probeSource.IndexOf($approvedParameter,[StringComparison]::Ordinal) -lt 0 -or
    $probeSource.IndexOf($trusted,[StringComparison]::Ordinal) -lt 0 -or
    $probeSource.IndexOf($dns,[StringComparison]::Ordinal) -le
        $probeSource.IndexOf($trusted,[StringComparison]::Ordinal)) {
    throw 'N49 approved signer certificate pin is not enforced before application DNS.'
}

Import-Module -Name $moduleFile -Force -ErrorAction Stop
$curlPath = [IO.Path]::Combine([Environment]::SystemDirectory, 'curl.exe')
$signature = Get-AuthenticodeSignature -LiteralPath $curlPath -ErrorAction Stop
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
    throw 'Real system curl signer is unavailable to the N49 offline test.'
}
$cert = $signature.SignerCertificate
$hash = [System.Security.Cryptography.SHA256]::Create()
try {
    $digest = $hash.ComputeHash($cert.RawData)
    $localCiOnlySha256 = [BitConverter]::ToString($digest).Replace('-', '')
} finally {
    $hash.Dispose()
}
if ($localCiOnlySha256 -cnotmatch '\A[0-9A-F]{64}\z') {
    throw 'N49 SHA-256 fixture calculation failed.'
}

if ((Assert-PublicWindowsApprovedCurlSignerPin -SignerCertificate $cert -ApprovedSignerSha256 $localCiOnlySha256) -ne $true -or
    (Assert-PublicWindowsApprovedCurlSignerPin -SignerCertificate $cert -ApprovedSignerSha256 $localCiOnlySha256.ToLowerInvariant()) -ne $true) {
    throw 'N49 valid signer hash was refused.'
}

function Assert-PinRejected {
    param([string]$Pin,[string]$Reason)
    $rejected = $false
    try {
        $null = Assert-PublicWindowsApprovedCurlSignerPin -SignerCertificate $cert -ApprovedSignerSha256 $Pin
    } catch {
        $rejected = $true
        if ($_.Exception.Message -cne 'Trusted Windows system curl signer pin blocked.') {
            throw 'N49 signer pin mismatch disclosed certificate data or operator input.'
        }
    }
    if (-not $rejected) { throw ('N49 accepted forged signer hash: ' + $Reason) }
}
$switched = if ($localCiOnlySha256[0] -ceq 'A') { 'B' } else { 'A' }
$wrong = $switched + $localCiOnlySha256.Substring(1)
foreach ($bad in @(
    @{pin=$wrong; reason='one-character SHA-256 mismatch'},
    @{pin=('0'*64); reason='different certificate SHA-256'},
    @{pin=$localCiOnlySha256.Substring(0,63);reason='truncated SHA-256'},
    @{pin=$localCiOnlySha256+'0';reason='extra character'},
    @{pin='0x'+$localCiOnlySha256;reason='0x prefix'},
    @{pin=$localCiOnlySha256+' ';reason='trailing whitespace'},
    @{pin=' '+$localCiOnlySha256;reason='leading whitespace'},
    @{pin=$localCiOnlySha256.Insert(4,':');reason='colon separator'},
    @{pin='';reason='blank pin'},
    @{pin=('Z'*64);reason='invalid hexadecimal'}
)) {
    Assert-PinRejected -Pin $bad.pin -Reason $bad.reason
}
# Enforce the pin on the *actual* system curl path: a wrong but
# syntactically valid hash must fail even though local Microsoft
# Authenticode is valid and its Schannel backend is supported.
$rejectWrong = $false
try {
    $null = Assert-PublicWindowsTrustedSystemCurl -ApprovedSignerSha256 $wrong
} catch {
    $rejectWrong = $true
    if ($_.Exception.Message -cne 'Trusted Windows system curl preflight blocked.') {
        throw 'N49 system curl pin failure exposed details.'
    }
}
if (-not $rejectWrong) {
    throw 'N49 OS curl preflight failed to enforce signer certificate pin.'
}
$verified = Assert-PublicWindowsTrustedSystemCurl -ApprovedSignerSha256 $localCiOnlySha256
if (-not [string]::Equals($verified,$curlPath,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'N49 OS curl preflight used a different executable.'
}

Write-Host 'N49 PASS: actual Windows signer SHA-256 comparison, malformed/mismatch rejection, and no customer request. CI-derived pin is NOT external approval.'
exit 0
