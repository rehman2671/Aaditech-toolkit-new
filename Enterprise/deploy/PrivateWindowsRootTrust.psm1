#Requires -Version 5.1
# Independently authenticated public root certificate only. No downloads,
# no broad store cleanup, no automatic trust of a server-provided root.
Set-StrictMode -Version Latest
function Assert-PrivateLanRootSelfSignature {
    param([Parameter(Mandatory=$true)][Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows certificate verification required.' }
    if (-not ('AadiTech.PrivateLan.NativeCertificateSignature' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace AadiTech.PrivateLan {
    public static class NativeCertificateSignature {
        [DllImport("crypt32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CryptVerifyCertificateSignatureEx(
            IntPtr provider, uint encoding, uint subjectType, IntPtr subject,
            uint issuerType, IntPtr issuer, uint flags, IntPtr extra);
        public static bool VerifySelfSignature(IntPtr context) {
            // CERT_CONTEXT (2) on both sides: cryptographic verification only.
            // No chain engine, URL retrieval or trust-store installation.
            return context != IntPtr.Zero && CryptVerifyCertificateSignatureEx(
                IntPtr.Zero, 0x00010001, 2, context, 2, context, 0, IntPtr.Zero);
        }
    }
}
'@ -ErrorAction Stop
    }
    if (-not [AadiTech.PrivateLan.NativeCertificateSignature]::VerifySelfSignature($Certificate.Handle)) { throw 'Root self-signature invalid.' }
}
function Read-PinnedPrivateLanRoot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$CertificatePath,
        [Parameter(Mandatory=$true)][string]$ApprovedRootSha256
    )
    $stream = $null; $cert = $null; $sha = $null; $success = $false
    try {
        if ($ApprovedRootSha256 -cnotmatch '\A[0-9a-fA-F]{64}\z' -or $ApprovedRootSha256 -match '\A0{64}\z') { throw 'Invalid independent pin.' }
        if ($CertificatePath -cnotmatch '\A[A-Za-z]:\\' -or $CertificatePath.Substring(2).Contains(':')) { throw 'Local absolute file required.' }
        $full = [IO.Path]::GetFullPath($CertificatePath)
        if ($full -cne $CertificatePath) { throw 'Canonical path required.' }
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($full))
        if ($drive.DriveType -notin @([IO.DriveType]::Fixed,[IO.DriveType]::Removable)) { throw 'Local physical volume required.' }
        $parent = [IO.Path]::GetDirectoryName($full)
        while ($null -ne $parent) {
            $d = Get-Item -LiteralPath $parent -Force -ErrorAction Stop
            if ($d -isnot [IO.DirectoryInfo] -or ($d.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe certificate ancestor.' }
            $parent = [IO.Path]::GetDirectoryName($parent)
        }
        $item = Get-Item -LiteralPath $full -Force -ErrorAction Stop
        if ($item -isnot [IO.FileInfo] -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -lt 1 -or $item.Length -gt 16384) { throw 'Invalid certificate file.' }
        $stream = [IO.File]::Open($item.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        if ($stream.Length -lt 1 -or $stream.Length -gt 16384) { throw 'Invalid certificate length.' }
        $raw = [byte[]]::new([int]$stream.Length); $offset = 0
        while ($offset -lt $raw.Length) {
            $read = $stream.Read($raw,$offset,$raw.Length-$offset)
            if ($read -le 0) { throw 'Incomplete certificate.' }
            $offset += $read
        }
        if ($stream.ReadByte() -ne -1) { throw 'Certificate changed length.' }
        if ($raw[0] -eq 45) {
            $pem = [Text.Encoding]::ASCII.GetString($raw)
            if ($pem -cnotmatch '\A-----BEGIN CERTIFICATE-----\r?\n([A-Za-z0-9+/=\r\n]+)-----END CERTIFICATE-----\r?\n?\z') { throw 'Single public certificate required.' }
            $raw = [Convert]::FromBase64String($Matches[1])
        }
        $sha = [Security.Cryptography.SHA256]::Create()
        $actual = ([BitConverter]::ToString($sha.ComputeHash($raw))).Replace('-','').ToLowerInvariant()
        if ($actual -cne $ApprovedRootSha256.ToLowerInvariant()) { throw 'Independent certificate pin mismatch.' }
        # Only load bytes AFTER the independent digest check. Reject PFX,
        # serialized stores, concatenated DER and any private key.
        $cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new($raw)
        if ($cert.HasPrivateKey -or [Convert]::ToBase64String($cert.RawData) -cne [Convert]::ToBase64String($raw) -or
            [Convert]::ToBase64String($cert.SubjectName.RawData) -cne [Convert]::ToBase64String($cert.IssuerName.RawData) -or
            $cert.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $cert.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) { throw 'Unusable root.' }
        $basic = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' })
        $usage = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.15' })
        $network = @($cert.Extensions | Where-Object { $_.Oid.Value -in @('1.3.6.1.5.5.7.1.1','2.5.29.31') })
        if ($basic.Count -ne 1 -or $usage.Count -ne 1 -or $network.Count -ne 0 -or -not $basic[0].Critical -or -not $usage[0].Critical) { throw 'Unsupported root policy.' }
        $bc = [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($basic[0],$basic[0].Critical)
        $ku = [Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage[0],$usage[0].Critical)
        $required = [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign
        if (-not $bc.CertificateAuthority -or -not $bc.HasPathLengthConstraint -or $bc.PathLengthConstraint -ne 0 -or ($ku.KeyUsages -band $required) -ne $required) { throw 'Direct-root CA policy required.' }
        Assert-PrivateLanRootSelfSignature -Certificate $cert
        $success = $true
        return $cert
    } catch { throw 'Pinned private LAN root certificate refused.' }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if ($null -ne $sha) { $sha.Dispose() }
        if (-not $success -and $null -ne $cert) { $cert.Dispose() }
    }
}
function Test-PrivateLanRootCertificate {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$CertificatePath,[Parameter(Mandatory=$true)][string]$ApprovedRootSha256)
    $cert = Read-PinnedPrivateLanRoot -CertificatePath $CertificatePath -ApprovedRootSha256 $ApprovedRootSha256
    try { return [ordered]@{schema_version=1;root_sha256=$ApprovedRootSha256.ToLowerInvariant();independent_pin_matched=$true;direct_root_policy_verified=$true;root_self_signature_verified=$true;trust_store_modified=$false;production_accepted=$false} }
    finally { $cert.Dispose() }
}
function Install-PrivateLanRootCertificate {
    [CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
    param(
        [Parameter(Mandatory=$true)][string]$Confirmation,
        [Parameter(Mandatory=$true)][string]$CertificatePath,
        [Parameter(Mandatory=$true)][string]$ApprovedRootSha256
    )
    $cert = $null; $store = $null
    try {
        if ($Confirmation -cne 'INSTALL_INDEPENDENTLY_PINNED_PRIVATE_LAN_ROOT_LOCAL_MACHINE_ONLY') { throw 'Explicit local-machine trust approval required.' }
        $cert = Read-PinnedPrivateLanRoot -CertificatePath $CertificatePath -ApprovedRootSha256 $ApprovedRootSha256
        if (-not $PSCmdlet.ShouldProcess('LocalMachine\Root','Trust independently pinned private LAN root certificate')) { return }
        $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator required.' }
        $store = [Security.Cryptography.X509Certificates.X509Store]::new('Root',[Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite -bor [Security.Cryptography.X509Certificates.OpenFlags]::OpenExistingOnly)
        $expected = [Convert]::ToBase64String($cert.RawData)
        $matches = @($store.Certificates | Where-Object { $_.Thumbprint -ceq $cert.Thumbprint })
        if (@($matches | Where-Object { [Convert]::ToBase64String($_.RawData) -cne $expected }).Count -ne 0) { throw 'Existing certificate collision.' }
        $added = $matches.Count -eq 0
        if ($added) { $store.Add($cert) }
        $store.Close()
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly -bor [Security.Cryptography.X509Certificates.OpenFlags]::OpenExistingOnly)
        $after = @($store.Certificates | Where-Object { $_.Thumbprint -ceq $cert.Thumbprint })
        if ($after.Count -lt 1 -or @($after | Where-Object { [Convert]::ToBase64String($_.RawData) -cne $expected }).Count -ne 0) { throw 'Trust readback unconfirmed.' }
        return [ordered]@{schema_version=1;root_sha256=$ApprovedRootSha256.ToLowerInvariant();local_machine_root_observed=$true;root_self_signature_verified=$true;root_added=$added;existing_roots_removed=$false;windows_agent_https_verified=$false;production_accepted=$false}
    } catch { throw 'Private LAN root trust unconfirmed. Review the exact local-machine root entry; do not remove or retry automatically.' }
    finally {
        if ($null -ne $store) { $store.Close(); $store.Dispose() }
        if ($null -ne $cert) { $cert.Dispose() }
    }
}
Export-ModuleMember -Function Test-PrivateLanRootCertificate,Install-PrivateLanRootCertificate
