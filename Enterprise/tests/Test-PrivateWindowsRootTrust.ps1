#Requires -Version 5.1
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '../deploy/PrivateWindowsRootTrust.psm1') -Force
function Assert-Denied([scriptblock]$Action) {
    $denied=$false
    try { $null=& $Action } catch { $denied=$true }
    if (-not $denied) { throw 'Expected refusal.' }
}
$dir=Join-Path ([IO.Path]::GetTempPath()) ('aaditech-root-fixture-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $dir
$cert=$null; $sha=$null
try {
    # Ephemeral CurrentUser\My fixture only; never add a trusted root in CI.
    $cert=New-SelfSignedCertificate -Type Custom -Subject 'CN=AadiTech disposable root fixture' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -KeyUsageProperty Sign -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0','2.5.29.15={critical}{hex}03020106') -NotAfter (Get-Date).AddDays(1)
    $raw=$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $sha=[Security.Cryptography.SHA256]::Create()
    $pin=([BitConverter]::ToString($sha.ComputeHash($raw))).Replace('-','').ToLowerInvariant()
    $file=Join-Path $dir 'root.cer'
    [IO.File]::WriteAllBytes($file,$raw)
    $proof=Test-PrivateLanRootCertificate -CertificatePath $file -ApprovedRootSha256 $pin
    if (-not $proof.independent_pin_matched -or -not $proof.root_self_signature_verified -or $proof.trust_store_modified) { throw 'Unexpected root proof.' }
    $pem=Join-Path $dir 'root.pem'
    [IO.File]::WriteAllText($pem,("-----BEGIN CERTIFICATE-----"+[Environment]::NewLine+[Convert]::ToBase64String($raw,[Base64FormattingOptions]::InsertLineBreaks)+[Environment]::NewLine+"-----END CERTIFICATE-----"+[Environment]::NewLine),[Text.Encoding]::ASCII)
    $null=Test-PrivateLanRootCertificate -CertificatePath $pem -ApprovedRootSha256 $pin
    Assert-Denied { Test-PrivateLanRootCertificate -CertificatePath $file -ApprovedRootSha256 ('0'*64) }
    Assert-Denied { Test-PrivateLanRootCertificate -CertificatePath $file -ApprovedRootSha256 ('b'*64) }
    Assert-Denied { Test-PrivateLanRootCertificate -CertificatePath 'relative.cer' -ApprovedRootSha256 $pin }
    Assert-Denied { Install-PrivateLanRootCertificate -Confirmation 'yes' -CertificatePath $file -ApprovedRootSha256 $pin -WhatIf }
    $before=@(Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }).Count
    $null=Install-PrivateLanRootCertificate -Confirmation 'INSTALL_INDEPENDENTLY_PINNED_PRIVATE_LAN_ROOT_LOCAL_MACHINE_ONLY' -CertificatePath $file -ApprovedRootSha256 $pin -WhatIf
    $after=@(Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }).Count
    if ($before -ne $after) { throw 'WhatIf changed local-machine trust.' }
    # Change a signature byte, compute a matching independent fixture digest,
    # and prove that DER pin/subject/issuer alone cannot admit the root.
    $bad = [byte[]]$raw.Clone()
    $bad[$bad.Length-1] = $bad[$bad.Length-1] -bxor 1
    $badFile = Join-Path $dir 'bad-signature.cer'
    [IO.File]::WriteAllBytes($badFile,$bad)
    $badPin = ([BitConverter]::ToString($sha.ComputeHash($bad))).Replace('-','').ToLowerInvariant()
    Assert-Denied { Test-PrivateLanRootCertificate -CertificatePath $badFile -ApprovedRootSha256 $badPin }
    [IO.File]::AppendAllText($pem,'trailing')
    Assert-Denied { Test-PrivateLanRootCertificate -CertificatePath $pem -ApprovedRootSha256 $pin }
    Write-Host 'PASS: independently pinned public DER/PEM root policy, incorrect pin and confirmation denial, WhatIf leaves machine trust unchanged.'
} finally {
    if ($null -ne $sha) { $sha.Dispose() }
    if ($null -ne $cert) {
        Remove-Item -LiteralPath ('Cert:\CurrentUser\My\'+$cert.Thumbprint) -Force -ErrorAction Stop
        $cert.Dispose()
    }
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop
}
