# Sign the EXE before WiX bundles it, then sign MSI. Never import an internal CA.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('PrePackage','Finalize')][string]$Stage)
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'out'
$exe = Join-Path $out 'IT-Toolkit-Agent.exe'
function Flag($key, $value) {
  "$key=$value" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
}
$names = @('CODESIGN_PFX_B64','CODESIGN_PFX_PASSWORD','CODESIGN_APPROVED_THUMBPRINT')
$present = @($names | Where-Object { -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }).Count
if ($Stage -eq 'PrePackage' -and $present -eq 0) {
  Flag 'RELEASE_SIGNING_ENABLED' 'false'
  Flag 'PUBLISH_SIGNED' 'false'
  Write-Host '::warning::Approved signing credentials absent: diagnostic MSI only, no release.'
  return
}
if ($Stage -eq 'Finalize' -and $env:RELEASE_SIGNING_ENABLED -eq 'false') {
  Flag 'PUBLISH_SIGNED' 'false'
  return
}
if ($present -ne $names.Count) { throw 'Incomplete release signing credentials.' }
# Defense in depth: do not sign in an automatic push, PR or scheduled job
# even if repository-level secrets are accidentally still configured.
# GitHub environment reviewers remain mandatory for production approval.
if ($env:GITHUB_ACTIONS -cne 'true' -or
    $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
    $env:GITHUB_REF -cne 'refs/heads/main') {
  throw 'Release signing is permitted only by manually dispatched main-branch GitHub Actions with protected environment approval.'
}
if ($Stage -eq 'Finalize' -and $env:RELEASE_SIGNING_ENABLED -ne 'true') {
  throw 'No verified prepackage signature. Refusing MSI publication.'
}
# Preserve the existing fail-closed malformed publisher thumbprint check
# before N56 (both checks occur before PFX allocation or signtool).
$expected = ($env:CODESIGN_APPROVED_THUMBPRINT -replace '\s','').ToUpperInvariant()
if ($expected -cnotmatch '^[A-F0-9]{40}
# source revision or newly substituted, independently signed release record.
# Reverify reviewer RSA-2048/4096 signature and exact release scope before
# importing the PFX or invoking signtool on BOTH release signing phases.
$releaseAuthorization = Join-Path $PSScriptRoot 'Assert-ReleaseAuthorization.ps1'
$approvedReleaseDigest = ''
if ($Stage -eq 'PrePackage') {
  $approvedReleaseDigest = & $releaseAuthorization -StartSigning
  if ($approvedReleaseDigest -cnotmatch '\A[0-9A-F]{64}\z') {
    throw 'N56 reviewer-signed release identity missing.'
  }
} else {
  $null = & $releaseAuthorization -RequireOriginalDigest
}
$sdk = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits\10\bin'
$tool = Get-ChildItem $sdk -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\d+\.\d+\.\d+\.\d+\\x64' } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $tool) { throw 'Windows SDK signtool missing.' }
function Confirm-Signature($file) {
  & $tool.FullName verify /pa /v $file
  if ($LASTEXITCODE -ne 0) { throw "OS-trusted Authenticode chain missing: $file" }
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
      $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $expected -or
      -not $signature.TimeStamperCertificate) {
    throw "Approved timestamped Authenticode signature missing: $file"
  }
}
$pfx = Join-Path $env:RUNNER_TEMP ('aaditech-sign-' + [guid]::NewGuid().ToString('N') + '.pfx')
try {
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:CODESIGN_PFX_B64))
  $flag = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
  $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $pfx, $env:CODESIGN_PFX_PASSWORD, $flag)
  if (-not $certificate.HasPrivateKey -or $certificate.Thumbprint.ToUpperInvariant() -ne $expected) {
    throw 'Unapproved PFX certificate or missing private key.'
  }
  if ([DateTime]::UtcNow -lt $certificate.NotBefore.ToUniversalTime() -or
      [DateTime]::UtcNow -gt $certificate.NotAfter.ToUniversalTime()) {
    throw 'Signing certificate expired or not yet valid.'
  }
  $codeEku = @($certificate.Extensions | Where-Object {
    $_ -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]
  } | ForEach-Object { $_.EnhancedKeyUsages } | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' })
  if ($codeEku.Count -eq 0) { throw 'Code signing EKU missing.' }
  if ($Stage -eq 'PrePackage') {
    if (-not (Test-Path $exe)) { throw 'Agent EXE not yet built.' }
    $toSign = @($exe)
  } else {
    $msis = @(Get-ChildItem -Path $out -File -Filter 'IT-Toolkit-Agent-*.msi')
    if ($msis.Count -ne 1) { throw 'Exactly one release MSI required.' }
    Confirm-Signature $exe
    $toSign = @($msis[0].FullName)
  }
  foreach ($target in $toSign) {
    & $tool.FullName sign /f $pfx /p $env:CODESIGN_PFX_PASSWORD /fd SHA256 /tr https://timestamp.digicert.com /td SHA256 $target
    if ($LASTEXITCODE -ne 0) { throw "RFC3161 signing failed: $target" }
    Confirm-Signature $target
  }
  if ($Stage -eq 'PrePackage') {
    # Only after the EXE is independently signed and signature-verified;
    # downstream phases re-authenticate this exact record, not just its pins.
    Flag 'RELEASE_APPROVAL_MANIFEST_SHA256' $approvedReleaseDigest
    Flag 'RELEASE_SIGNING_ENABLED' 'true'
  } else {
    @($exe, $msis[0].FullName) | ForEach-Object {
      $sum = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
      "$sum  $([IO.Path]::GetFileName($_))"
    } | Set-Content -LiteralPath (Join-Path $out 'SHA256SUMS.txt') -Encoding ascii
    Flag 'PUBLISH_SIGNED' 'true'
  }
} finally {
  if (Test-Path -LiteralPath $pfx) { Remove-Item -LiteralPath $pfx -Force }
}
) { throw 'Approved thumbprint must be exactly 40 hex characters.' }
# N56: even approved signing credentials cannot authorize an arbitrary
# source revision or newly substituted, independently signed release record.
# Reverify reviewer RSA-2048/4096 signature and exact release scope before
# importing the PFX or invoking signtool on BOTH release signing phases.
$releaseAuthorization = Join-Path $PSScriptRoot 'Assert-ReleaseAuthorization.ps1'
$approvedReleaseDigest = ''
if ($Stage -eq 'PrePackage') {
  $approvedReleaseDigest = & $releaseAuthorization -StartSigning
  if ($approvedReleaseDigest -cnotmatch '\A[0-9A-F]{64}\z') {
    throw 'N56 reviewer-signed release identity missing.'
  }
} else {
  $null = & $releaseAuthorization -RequireOriginalDigest
}
$sdk = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits\10\bin'
$tool = Get-ChildItem $sdk -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\d+\.\d+\.\d+\.\d+\\x64' } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $tool) { throw 'Windows SDK signtool missing.' }
function Confirm-Signature($file) {
  & $tool.FullName verify /pa /v $file
  if ($LASTEXITCODE -ne 0) { throw "OS-trusted Authenticode chain missing: $file" }
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
      $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $expected -or
      -not $signature.TimeStamperCertificate) {
    throw "Approved timestamped Authenticode signature missing: $file"
  }
}
$pfx = Join-Path $env:RUNNER_TEMP ('aaditech-sign-' + [guid]::NewGuid().ToString('N') + '.pfx')
try {
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:CODESIGN_PFX_B64))
  $flag = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
  $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $pfx, $env:CODESIGN_PFX_PASSWORD, $flag)
  if (-not $certificate.HasPrivateKey -or $certificate.Thumbprint.ToUpperInvariant() -ne $expected) {
    throw 'Unapproved PFX certificate or missing private key.'
  }
  if ([DateTime]::UtcNow -lt $certificate.NotBefore.ToUniversalTime() -or
      [DateTime]::UtcNow -gt $certificate.NotAfter.ToUniversalTime()) {
    throw 'Signing certificate expired or not yet valid.'
  }
  $codeEku = @($certificate.Extensions | Where-Object {
    $_ -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]
  } | ForEach-Object { $_.EnhancedKeyUsages } | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' })
  if ($codeEku.Count -eq 0) { throw 'Code signing EKU missing.' }
  if ($Stage -eq 'PrePackage') {
    if (-not (Test-Path $exe)) { throw 'Agent EXE not yet built.' }
    $toSign = @($exe)
  } else {
    $msis = @(Get-ChildItem -Path $out -File -Filter 'IT-Toolkit-Agent-*.msi')
    if ($msis.Count -ne 1) { throw 'Exactly one release MSI required.' }
    Confirm-Signature $exe
    $toSign = @($msis[0].FullName)
  }
  foreach ($target in $toSign) {
    & $tool.FullName sign /f $pfx /p $env:CODESIGN_PFX_PASSWORD /fd SHA256 /tr https://timestamp.digicert.com /td SHA256 $target
    if ($LASTEXITCODE -ne 0) { throw "RFC3161 signing failed: $target" }
    Confirm-Signature $target
  }
  if ($Stage -eq 'PrePackage') {
    # Only after the EXE is independently signed and signature-verified;
    # downstream phases re-authenticate this exact record, not just its pins.
    Flag 'RELEASE_APPROVAL_MANIFEST_SHA256' $approvedReleaseDigest
    Flag 'RELEASE_SIGNING_ENABLED' 'true'
  } else {
    @($exe, $msis[0].FullName) | ForEach-Object {
      $sum = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
      "$sum  $([IO.Path]::GetFileName($_))"
    } | Set-Content -LiteralPath (Join-Path $out 'SHA256SUMS.txt') -Encoding ascii
    Flag 'PUBLISH_SIGNED' 'true'
  }
} finally {
  if (Test-Path -LiteralPath $pfx) { Remove-Item -LiteralPath $pfx -Force }
}
