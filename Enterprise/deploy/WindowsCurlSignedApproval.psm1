#Requires -Version 5.1
# Phase N51: offline reviewer-signed, short-lived binding of destination
# origin and Windows system curl signer/binary pins. No customer network,
# executable launching or private reviewer key in this module.
Set-StrictMode -Version Latest

function Read-N51BoundedLocalFile {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Path,
          [Parameter(Mandatory=$true)][int]$MaxBytes,
          [Parameter(Mandatory=$true)][int]$MinBytes)
    $stream = $null
    try {
        if ([string]::IsNullOrWhiteSpace($Path) -or
            -not [IO.Path]::IsPathRooted($Path) -or
            $Path.StartsWith('\\',[StringComparison]::Ordinal)) {
            throw 'Local ordinary file required.'
        }
        $full = [IO.Path]::GetFullPath($Path)
        if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($full)).DriveType -ne
            [IO.DriveType]::Fixed) { throw 'Approval file must be local.' }
        $cursor = [IO.Path]::GetDirectoryName($full)
        while (-not [string]::IsNullOrWhiteSpace($cursor)) {
            $dir = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if ($dir -isnot [IO.DirectoryInfo] -or
                ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Reparse ancestor refused.'
            }
            $above = [IO.Path]::GetDirectoryName($cursor.TrimEnd('\'))
            if ([string]::IsNullOrWhiteSpace($above) -or $above -ceq $cursor) {
                break
            }
            $cursor = $above
        }
        $file = Get-Item -LiteralPath $full -Force -ErrorAction Stop
        if ($file -isnot [IO.FileInfo] -or
            ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $file.Length -lt $MinBytes -or $file.Length -gt $MaxBytes) {
            throw 'Approval file metadata rejected.'
        }
        $stream = [IO.File]::Open($full,[IO.FileMode]::Open,
            [IO.FileAccess]::Read,[IO.FileShare]::Read)
        if ($stream.Length -lt $MinBytes -or $stream.Length -gt $MaxBytes) {
            throw 'Approval file length changed.'
        }
        $bytes = [byte[]]::new([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $count = $stream.Read($bytes,$offset,$bytes.Length-$offset)
            if ($count -le 0) { throw 'Approval file incomplete.' }
            $offset += $count
        }
        if ($stream.Length -ne $bytes.Length) {
            throw 'Approval file changed during reading.'
        }
        return ,$bytes
    } catch {
        throw 'Windows curl approval manifest blocked.'
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Assert-PublicWindowsCurlApprovalContent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Content,
        [Parameter(Mandatory=$true)][string]$ExpectedOrigin,
        [Parameter(Mandatory=$true)][string]$ExpectedSignerSha256,
        [Parameter(Mandatory=$true)][string]$ExpectedBinarySha256,
        [DateTime]$NowUtc = [DateTime]::UtcNow
    )
    try {
        if ($Content.Length -lt 150 -or $Content.Length -gt 2048 -or
            $Content -cnotmatch '\A[\x20-\x7e\n]+\z' -or
            $ExpectedOrigin -cnotmatch '\Ahttps://[a-z0-9][a-z0-9.-]*\z' -or
            $ExpectedSignerSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z' -or
            $ExpectedBinarySha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
            throw 'Manifest or expected pins are malformed.'
        }
        $lines = @($Content.Split([char]10))
        if ($lines.Count -ne 8 -or $lines[7] -cne '' -or
            $lines[0] -cne 'AADITECH-CURL-APPROVAL-V1' -or
            $lines[1] -cne ('origin=' + $ExpectedOrigin) -or
            $lines[2] -cnotmatch '\Asigner_cert_sha256=[0-9A-Fa-f]{64}\z' -or
            $lines[3] -cnotmatch '\Acurl_binary_sha256=[0-9A-Fa-f]{64}\z' -or
            $lines[4] -cnotmatch '\Aissued_utc=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\z' -or
            $lines[5] -cnotmatch '\Aexpires_utc=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\z' -or
            $lines[6] -cnotmatch '\Aapproval_id=[A-Za-z0-9][A-Za-z0-9._-]{7,63}\z') {
            throw 'Canonical manifest order/shape rejected.'
        }
        if (-not [string]::Equals(
                $lines[2].Substring('signer_cert_sha256='.Length),
                $ExpectedSignerSha256,[StringComparison]::OrdinalIgnoreCase) -or
            -not [string]::Equals(
                $lines[3].Substring('curl_binary_sha256='.Length),
                $ExpectedBinarySha256,[StringComparison]::OrdinalIgnoreCase)) {
            throw 'Manifest does not bind both approved pins.'
        }
        $culture = [Globalization.CultureInfo]::InvariantCulture
        $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor
                  [Globalization.DateTimeStyles]::AdjustToUniversal
        $format = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        $issued = [DateTime]::ParseExact($lines[4].Substring('issued_utc='.Length),
            $format,$culture,$styles)
        $expires = [DateTime]::ParseExact($lines[5].Substring('expires_utc='.Length),
            $format,$culture,$styles)
        if ($issued -gt $NowUtc.AddMinutes(5) -or
            $issued -lt $NowUtc.AddHours(-24) -or
            $expires -le $NowUtc -or
            $expires -le $issued -or
            $expires -gt $issued.AddHours(24)) {
            throw 'Approval validity window rejected.'
        }
        return $true
    } catch { throw 'Windows curl approval manifest blocked.' }
}

function Assert-PublicWindowsCurlSignedApproval {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ManifestPath,
        [Parameter(Mandatory=$true)][string]$SignaturePath,
        [Parameter(Mandatory=$true)][string]$ReviewerCertificatePath,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedReviewerCertificateSha256,
        [Parameter(Mandatory=$true)][string]$ExpectedOrigin,
        [Parameter(Mandatory=$true)][string]$ExpectedSignerSha256,
        [Parameter(Mandatory=$true)][string]$ExpectedBinarySha256,
        # N53: the first verified manifest digest is carried only in memory.
        # Later gates refuse a newly signed but different approval record.
        [AllowEmptyString()][string]$ExpectedManifestSha256,
        [switch]$ReturnManifestSha256
    )
    $certificate = $null
    $rsa = $null
    $sha = $null
    try {
        if ($env:OS -cne 'Windows_NT' -or
            $ApprovedReviewerCertificateSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
            throw 'Approved reviewer fingerprint required.'
        }
        $manifest = Read-N51BoundedLocalFile -Path $ManifestPath -MaxBytes 2048 -MinBytes 150
        $signature = Read-N51BoundedLocalFile -Path $SignaturePath -MaxBytes 512 -MinBytes 256
        $certBytes = Read-N51BoundedLocalFile -Path $ReviewerCertificatePath -MaxBytes 16384 -MinBytes 256
        foreach ($byte in $manifest) {
            if ($byte -ne 10 -and ($byte -lt 32 -or $byte -gt 126)) {
                throw 'Manifest is not strictly LF-terminated printable ASCII.'
            }
        }
        $text = [Text.Encoding]::ASCII.GetString($manifest)
        $null = Assert-PublicWindowsCurlApprovalContent -Content $text -ExpectedOrigin $ExpectedOrigin -ExpectedSignerSha256 $ExpectedSignerSha256 -ExpectedBinarySha256 $ExpectedBinarySha256
        $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certBytes)
        $sha = [Security.Cryptography.SHA256]::Create()
        $digest = $sha.ComputeHash($certificate.RawData)
        if ($digest.Length -ne 32) { throw 'Certificate digest rejected.' }
        $different = 0
        for ($i=0; $i -lt 32; $i++) {
            $expected = [Convert]::ToByte($ApprovedReviewerCertificateSha256.Substring($i*2,2),16)
            $different = $different -bor ([int]$expected -bxor [int]$digest[$i])
        }
        if ($different -ne 0) { throw 'Unapproved reviewer certificate.' }
        $now = [DateTime]::UtcNow
        if ($certificate.NotBefore.ToUniversalTime() -gt $now -or
            $certificate.NotAfter.ToUniversalTime() -le $now) {
            throw 'Reviewer certificate validity window rejected.'
        }
        $rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($certificate)
        if ($null -eq $rsa -or $rsa.KeySize -lt 2048 -or
            $rsa.KeySize -gt 4096 -or $signature.Length -ne ($rsa.KeySize / 8) -or
            -not $rsa.VerifyData($manifest,$signature,
                [Security.Cryptography.HashAlgorithmName]::SHA256,
                [Security.Cryptography.RSASignaturePadding]::Pkcs1)) {
            throw 'Signed manifest not verified.'
        }
        # N53: bind the WHOLE live diagnostic to the exact initially
        # approved canonical manifest, not merely the same reviewer key,
        # origin and curl pins. A separately signed replacement approval
        # must not silently take over a diagnostic already in progress.
        # Compute only after the reviewer signature is authenticated.
        $manifestDigest = $sha.ComputeHash($manifest)
        if ($PSBoundParameters.ContainsKey('ExpectedManifestSha256')) {
            if ($ExpectedManifestSha256 -cnotmatch '\\A[0-9A-Fa-f]{64}\\z') {
                throw 'Initial approved manifest digest required.'
            }
            $different = 0
            for ($i = 0; $i -lt 32; $i++) {
                $expected = [Convert]::ToByte($ExpectedManifestSha256.Substring($i*2,2),16)
                $different = $different -bor ([int]$expected -bxor [int]$manifestDigest[$i])
            }
            if ($different -ne 0) { throw 'Approval changed during diagnostic.' }
        }
        if ($ReturnManifestSha256) {
            return [BitConverter]::ToString($manifestDigest).Replace('-','')
        }
        return $true
    } catch {
        throw 'Windows curl approval manifest blocked.'
    } finally {
        if ($null -ne $rsa) { $rsa.Dispose() }
        if ($null -ne $sha) { $sha.Dispose() }
        if ($null -ne $certificate) { $certificate.Dispose() }
    }
}

Export-ModuleMember -Function Assert-PublicWindowsCurlApprovalContent, Assert-PublicWindowsCurlSignedApproval
