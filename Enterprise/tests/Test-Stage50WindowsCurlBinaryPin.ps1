#Requires -Version 5.1
# N50: offline file-digest fault injection, OS curl identity regression.
# CI-only self-derived signer and executable hashes do NOT establish any
# independently approved customer Windows deployment, publisher, or TLS.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N50 tests require actual Windows.' }

$modulePath = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\TrustedWindowsSystemCurl.psm1'))
$operatorPath = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
$source = [IO.File]::ReadAllText($modulePath)
$operator = [IO.File]::ReadAllText($operatorPath)
foreach ($unsafe in @('GetHostAddresses','Invoke-RestMethod','Invoke-WebRequest',
    'TcpClient','--insecure','--location','--proxy','--cacert')) {
    if ($source.IndexOf($unsafe,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'N50 local binary digest module included a network or unsafe operation.'
    }
}
$binaryRequired = '$ApprovedCurlBinarySha256 -cnotmatch'
$trusted = '$curl = Assert-PublicWindowsTrustedSystemCurl'
$binaryCall = ' -ApprovedBinarySha256 $ApprovedCurlBinarySha256'
$resolver = '[System.Net.Dns]::GetHostAddresses'
$post = 'Assert-PublicWindowsApprovedCurlBinaryPin -BinaryPath $curl -ApprovedBinarySha256 $ApprovedCurlBinarySha256'
if ($operator.IndexOf($binaryRequired,[StringComparison]::Ordinal) -lt 0 -or
    $operator.IndexOf($binaryCall,[StringComparison]::Ordinal) -lt 0 -or
    $operator.IndexOf($resolver,[StringComparison]::Ordinal) -le
      $operator.IndexOf($trusted,[StringComparison]::Ordinal) -or
    $operator.IndexOf($post,[StringComparison]::Ordinal) -lt 0 -or
    $operator.IndexOf($post,[StringComparison]::Ordinal) -le
      $operator.IndexOf('& $curl @curlArguments',[StringComparison]::Ordinal)) {
    throw 'N50 must verify approved EXE digest before DNS and after HTTPS transfer.'
}
Import-Module -Name $modulePath -Force -ErrorAction Stop

function Assert-BinaryRejected {
    param([string]$Path,[string]$Pin,[string]$Reason)
    $refused = $false
    try {
        $null = Assert-PublicWindowsApprovedCurlBinaryPin -BinaryPath $Path -ApprovedBinarySha256 $Pin
    } catch {
        $refused = $true
        if ($_.Exception.Message -cne 'Trusted Windows system curl binary pin blocked.') {
            throw 'N50 leaked file content, local path or approval hash on refusal.'
        }
    }
    if (-not $refused) { throw ('N50 accepted unsafe file pin: ' + $Reason) }
}
$root = Join-Path ([IO.Path]::GetTempPath()) ('n50-local-only-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($root)
try {
    $fixture = Join-Path $root 'synthetic-curl.bin'
    [IO.File]::WriteAllBytes($fixture, [Text.Encoding]::ASCII.GetBytes('N50 synthetic Windows binary fixture - not an executable'))
    $fixtureHash = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256 -ErrorAction Stop).Hash
    if ((Assert-PublicWindowsApprovedCurlBinaryPin -BinaryPath $fixture -ApprovedBinarySha256 $fixtureHash) -ne $true -or
        (Assert-PublicWindowsApprovedCurlBinaryPin -BinaryPath $fixture -ApprovedBinarySha256 $fixtureHash.ToLowerInvariant()) -ne $true) {
        throw 'N50 valid local binary SHA-256 digest was refused.'
    }
    $changed = if ($fixtureHash[0] -ceq 'F') {'E'} else {'F'}
    $wrong = $changed + $fixtureHash.Substring(1)
    foreach ($bad in @(
        @{pin=$wrong;reason='one-character mismatch'},
        @{pin=('0'*64);reason='different executable SHA-256'},
        @{pin=$fixtureHash.Substring(0,63);reason='SHA-256 truncation'},
        @{pin=($fixtureHash+'0');reason='extra digest character'},
        @{pin=('0x'+$fixtureHash);reason='hexadecimal prefix'},
        @{pin=($fixtureHash+' ');reason='trailing whitespace'},
        @{pin=(' '+$fixtureHash);reason='leading whitespace'},
        @{pin=$fixtureHash.Insert(3,':');reason='colon separator'},
        @{pin='';reason='missing binary pin'},
        @{pin=('X'*64);reason='non-hexadecimal input'}
    )) {
        Assert-BinaryRejected -Path $fixture -Pin $bad.pin -Reason $bad.reason
    }
    # Tamper detection: SAME approved digest against changed bytes fails
    # even though an approved signer certificate might remain unchanged.
    [IO.File]::AppendAllText($fixture,' tampered after approval')
    Assert-BinaryRejected -Path $fixture -Pin $fixtureHash -Reason 'modified binary after approval'

    $empty = Join-Path $root 'empty.bin'
    [IO.File]::WriteAllBytes($empty,[byte[]]::new(0))
    Assert-BinaryRejected -Path $empty -Pin $fixtureHash -Reason 'empty file'
    Assert-BinaryRejected -Path $root -Pin $fixtureHash -Reason 'directory not ordinary file'
    Assert-BinaryRejected -Path (Join-Path $root 'missing.bin') -Pin $fixtureHash -Reason 'missing executable'

    # Refuse oversized executable before reading all of its bytes.
    $oversized = Join-Path $root 'oversized.bin'
    $handle = [IO.File]::Open($oversized,[IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $handle.SetLength(67108865) } finally { $handle.Dispose() }
    Assert-BinaryRejected -Path $oversized -Pin $fixtureHash -Reason '64 MiB size cap'

    # Exercise the actual Microsoft-signed system curl with current OS
    # bytes and signer as CI *fixtures*. Not security-owner pin approval.
    $systemCurl = [IO.Path]::Combine([Environment]::SystemDirectory,'curl.exe')
    $sig = Get-AuthenticodeSignature -LiteralPath $systemCurl -ErrorAction Stop
    if ($sig.Status -ne 'Valid' -or $null -eq $sig.SignerCertificate) {
        throw 'N50 CI system curl Authenticode signer missing.'
    }
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $certHash = [BitConverter]::ToString($hasher.ComputeHash($sig.SignerCertificate.RawData)).Replace('-','')
    } finally { $hasher.Dispose() }
    $binaryHash = (Get-FileHash -LiteralPath $systemCurl -Algorithm SHA256 -ErrorAction Stop).Hash
    if ((Assert-PublicWindowsApprovedCurlBinaryPin -BinaryPath $systemCurl -ApprovedBinarySha256 $binaryHash) -ne $true) {
        throw 'N50 current system curl file digest was unexpectedly refused.'
    }
    $rejectedWrongExe = $false
    try {
        $null = Assert-PublicWindowsTrustedSystemCurl -ApprovedSignerSha256 $certHash -ApprovedBinarySha256 $wrong
    } catch {
        $rejectedWrongExe = $true
        if ($_.Exception.Message -cne 'Trusted Windows system curl preflight blocked.') {
            throw 'N50 system curl rejection leaked protected data.'
        }
    }
    if (-not $rejectedWrongExe) { throw 'N50 system curl admitted an unapproved binary digest.' }
    $vetted = Assert-PublicWindowsTrustedSystemCurl -ApprovedSignerSha256 $certHash -ApprovedBinarySha256 $binaryHash
    if (-not [string]::Equals($vetted,$systemCurl,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'N50 selected untrusted curl via PATH or substitution.'
    }
    Write-Host 'N50 PASS: exact 64-hex executable hash, byte-tamper/oversize refusal and signed Windows curl test; no customer DNS/HTTP.'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
