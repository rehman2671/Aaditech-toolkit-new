#Requires -Version 5.1
# N56: reviewer-signed, short-lived, exact-source release approval.
# Offline only. Reviewer private keys are NEVER in this module or CI.
Set-StrictMode -Version Latest

function Assert-N56ReviewedRelease {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ManifestBase64,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$SignatureBase64,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ReviewerDerBase64,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedReviewerSha256,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedGitSha,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedAgentVersion,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedMsiRevision,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedPublisherThumbprint,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedSqliteArchiveSha256,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedSqliteExeSha256,
        [AllowEmptyString()][string]$ExpectedManifestSha256,
        [switch]$ReturnManifestSha256
    )
    $cert = $null
    $rsa = $null
    $sha = $null
    try {
        if ($env:OS -cne 'Windows_NT' -or
            $ApprovedReviewerSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z' -or
            $ExpectedGitSha -cnotmatch '\A[0-9a-f]{40}\z' -or
            $ExpectedAgentVersion -cnotmatch '\A(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,3})\z' -or
            $ExpectedMsiRevision -cnotmatch '\A(?:[1-9]|[1-9][0-9]{1,2})\z' -or
            $ExpectedPublisherThumbprint -cnotmatch '\A[0-9A-Fa-f]{40}\z' -or
            $ExpectedSqliteArchiveSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z' -or
            $ExpectedSqliteExeSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
            throw 'Unapproved release scope.'
        }
        # Strict bounded base64 avoids accidental PEM, whitespace,
        # non-ASCII encodings or arbitrarily large untrusted inputs.
        if ($ManifestBase64.Length -lt 200 -or $ManifestBase64.Length -gt 4096 -or
            $SignatureBase64.Length -lt 340 -or $SignatureBase64.Length -gt 700 -or
            $ReviewerDerBase64.Length -lt 340 -or $ReviewerDerBase64.Length -gt 22000 -or
            $ManifestBase64 -cnotmatch '\A[A-Za-z0-9+/]+={0,2}\z' -or
            $SignatureBase64 -cnotmatch '\A[A-Za-z0-9+/]+={0,2}\z' -or
            $ReviewerDerBase64 -cnotmatch '\A[A-Za-z0-9+/]+={0,2}\z') {
            throw 'Malformed approval encoding.'
        }
        $manifest = [Convert]::FromBase64String($ManifestBase64)
        $signature = [Convert]::FromBase64String($SignatureBase64)
        $certBytes = [Convert]::FromBase64String($ReviewerDerBase64)
        if ($manifest.Length -lt 300 -or $manifest.Length -gt 2048 -or
            $signature.Length -lt 256 -or $signature.Length -gt 512 -or
            $certBytes.Length -lt 256 -or $certBytes.Length -gt 16384) {
            throw 'Unbounded release approval.'
        }
        foreach ($b in $manifest) {
            if ($b -ne 10 -and ($b -lt 32 -or $b -gt 126)) {
                throw 'Approval is not canonical printable ASCII LF.'
            }
        }
        $lines = @(([Text.Encoding]::ASCII.GetString($manifest)).Split([char]10))
        if ($lines.Count -ne 11 -or $lines[10] -cne '' -or
            $lines[0] -cne 'AADITECH-MSI-RELEASE-V1' -or
            $lines[1] -cne ('git_sha=' + $ExpectedGitSha) -or
            $lines[2] -cne ('agent_version=' + $ExpectedAgentVersion) -or
            $lines[3] -cne ('msi_revision=' + $ExpectedMsiRevision) -or
            $lines[4] -cne ('publisher_thumbprint=' + $ExpectedPublisherThumbprint.ToUpperInvariant()) -or
            $lines[5] -cne ('sqlite_archive_sha256=' + $ExpectedSqliteArchiveSha256.ToUpperInvariant()) -or
            $lines[6] -cne ('sqlite_exe_sha256=' + $ExpectedSqliteExeSha256.ToUpperInvariant()) -or
            $lines[7] -cnotmatch '\Aissued_utc=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\z' -or
            $lines[8] -cnotmatch '\Aexpires_utc=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\z' -or
            $lines[9] -cnotmatch '\Aapproval_id=[A-Za-z0-9][A-Za-z0-9._-]{7,63}\z') {
            throw 'Wrong release scope, ordering or canonical syntax.'
        }
        $culture=[Globalization.CultureInfo]::InvariantCulture
        $styles=[Globalization.DateTimeStyles]::AssumeUniversal -bor
            [Globalization.DateTimeStyles]::AdjustToUniversal
        $format="yyyy-MM-dd'T'HH:mm:ss'Z'"
        $issued=[DateTime]::ParseExact($lines[7].Substring(11),$format,$culture,$styles)
        $expires=[DateTime]::ParseExact($lines[8].Substring(12),$format,$culture,$styles)
        $now=[DateTime]::UtcNow
        if ($issued -gt $now.AddMinutes(5) -or
            $issued -lt $now.AddHours(-24) -or
            $expires -le $now -or
            $expires -le $issued -or
            $expires -gt $issued.AddHours(24)) {
            throw 'Release approval expired or not yet issued.'
        }
        $cert=[Security.Cryptography.X509Certificates.X509Certificate2]::new($certBytes)
        $sha=[Security.Cryptography.SHA256]::Create()
        $certDigest=$sha.ComputeHash($cert.RawData)
        $difference=0
        for ($i=0;$i -lt 32;$i++) {
            $expected=[Convert]::ToByte($ApprovedReviewerSha256.Substring(2*$i,2),16)
            $difference=$difference -bor ([int]$expected -bxor [int]$certDigest[$i])
        }
        if ($difference -ne 0 -or $cert.NotBefore.ToUniversalTime() -gt $now -or
            $cert.NotAfter.ToUniversalTime() -le $now) {
            throw 'Reviewer public-key custody or certificate window invalid.'
        }
        $rsa=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($cert)
        if ($null -eq $rsa -or $rsa.KeySize -lt 2048 -or $rsa.KeySize -gt 4096 -or
            $signature.Length -ne ($rsa.KeySize / 8) -or
            -not $rsa.VerifyData($manifest,$signature,
                [Security.Cryptography.HashAlgorithmName]::SHA256,
                [Security.Cryptography.RSASignaturePadding]::Pkcs1)) {
            throw 'Reviewer RSA-SHA256 signature invalid.'
        }
        $digest=$sha.ComputeHash($manifest)
        if ($PSBoundParameters.ContainsKey('ExpectedManifestSha256')) {
            if ($ExpectedManifestSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
                throw 'Missing initial release approval identity.'
            }
            $different=0
            for ($i=0;$i -lt 32;$i++) {
                $expected=[Convert]::ToByte($ExpectedManifestSha256.Substring(2*$i,2),16)
                $different=$different -bor ([int]$expected -bxor [int]$digest[$i])
            }
            if ($different -ne 0) { throw 'Release approval changed during pipeline.' }
        }
        if ($ReturnManifestSha256) {
            return [BitConverter]::ToString($digest).Replace('-','')
        }
        return $true
    } catch {
        # Never disclose sensitive paths, exact hashes, approval or signatures.
        throw 'N56 independently signed release approval blocked.'
    } finally {
        if ($null -ne $rsa) { $rsa.Dispose() }
        if ($null -ne $sha) { $sha.Dispose() }
        if ($null -ne $cert) { $cert.Dispose() }
    }
}

Export-ModuleMember -Function Assert-N56ReviewedRelease
