#Requires -Version 5.1
# Phase N48: local Windows OS curl binary provenance and Schannel backend.
# This test never invokes the operator live mode or requests a customer URL.
# OS Authenticode uses the local Windows trust policy; depending on OS policy
# it may consult Windows certificate revocation services, not customer APIs.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N48 tests require Windows.' }

$moduleFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\TrustedWindowsSystemCurl.psm1'))
$operatorFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
$source = [IO.File]::ReadAllText($moduleFile)
$operator = [IO.File]::ReadAllText($operatorFile)
foreach ($unsafe in @(
    'GetHostAddresses','Invoke-WebRequest','Invoke-RestMethod','TcpClient',
    '--insecure','--location','--resolve','--proxy','--cacert'
)) {
    if ($source.IndexOf($unsafe,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'N48 local provenance module contains a network or unsafe curl operation.'
    }
}
foreach ($required in @(
    '[Environment]::SystemDirectory',
    "Join-Path", # only applies to operator wrapper, not module
    'Get-AuthenticodeSignature -LiteralPath $curlPath',
    '[IO.FileAttributes]::ReparsePoint',
    "& $curlPath -q --version",
    "Assert-PublicWindowsCurlVersionHeader -ExitCode $nativeExit"
)) {
    if ($required -ceq 'Join-Path') { continue }
    if ($source.IndexOf($required,[StringComparison]::Ordinal) -lt 0) {
        throw 'N48 signed system curl verification was removed.'
    }
}
$trusted = '$curl = Assert-PublicWindowsTrustedSystemCurl'
$resolver = '[System.Net.Dns]::GetHostAddresses'
$removeOverrides = '[Environment]::SetEnvironmentVariable($name, $null,'
$getVersion = 'TrustedWindowsSystemCurl.psm1'
if ($operator.IndexOf($getVersion,[StringComparison]::Ordinal) -lt 0 -or
    $operator.IndexOf($trusted,[StringComparison]::Ordinal) -lt 0 -or
    $operator.IndexOf($trusted,[StringComparison]::Ordinal) -le
        $operator.IndexOf($removeOverrides,[StringComparison]::Ordinal) -or
    $operator.IndexOf($resolver,[StringComparison]::Ordinal) -le
        $operator.IndexOf($trusted,[StringComparison]::Ordinal)) {
    throw 'N48 curl provenance or trust override guard must execute before DNS.'
}
if ($operator.IndexOf('& $curl @curlArguments',[StringComparison]::Ordinal) -lt 0) {
    throw 'N48 live request no longer uses the verified OS curl path.'
}

Import-Module -Name $moduleFile -Force -ErrorAction Stop

function Assert-ForgedCurlVersionRejected {
    param([int]$Code,[string[]]$Lines,[string]$Reason)
    $refused = $false
    try {
        $null = Assert-PublicWindowsCurlVersionHeader -ExitCode $Code -VersionLines $Lines
    } catch {
        $refused = $true
        if ($_.Exception.Message -cne 'Trusted Windows system curl preflight blocked.') {
            throw 'N48 untrusted native version output leaked in exception.'
        }
    }
    if (-not $refused) { throw ('N48 accepted forged native version: ' + $Reason) }
}

$valid = @(
    'curl 8.11.1 (Windows) libcurl/8.11.1 Schannel zlib/1.3.1',
    'Release-Date: 2025-02-01',
    'Protocols: http https',
    'Features: IPv6 SSL'
)
if ((Assert-PublicWindowsCurlVersionHeader -ExitCode 0 -VersionLines $valid) -ne $true) {
    throw 'N48 rejected a genuine-shape Schannel version header.'
}
foreach ($fake in @(
    @{code=6;lines=$valid;reason='failed executable despite Schannel-looking output'},
    @{code=0;lines=@();reason='missing header'},
    @{code=0;lines=@('curl 8.11.1 (Windows) libcurl/8.11.1 OpenSSL','Features: Schannel');reason='Schannel only on features line'},
    @{code=0;lines=@('status OK','curl 8.11.1 Schannel');reason='Schannel only in later line'},
    @{code=0;lines=@('curl 8.11.1 (Windows) libcurl/8.11.1 OpenSSL');reason='OpenSSL backend'},
    @{code=0;lines=@('curl unknown (Windows) libcurl/unknown Schannel');reason='malformed version'},
    @{code=0;lines=@('curl 8.11.1 (Windows) libcurl/8.11.1 Schannel' + ('x' * 1200));reason='oversized response line'},
    @{code=0;lines=@('curl 8.11.1 (Windows) libcurl/8.11.1 Schannel') + @('other') * 33;reason='too many output lines'}
)) {
    Assert-ForgedCurlVersionRejected -Code $fake.code -Lines $fake.lines -Reason $fake.reason
}

# Actually exercise local Authenticode and the OS curl backend on both
# Windows PowerShell runtimes, no valid operator live invocation.
$path = Assert-PublicWindowsTrustedSystemCurl
$expected = [IO.Path]::Combine([Environment]::SystemDirectory,'curl.exe')
if (-not [string]::Equals($path,$expected,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'N48 resolved PATH-overridden or non-system curl.'
}

Write-Host 'N48 PASS: OS signed curl and Schannel verified locally on actual Windows; forged output refused and no customer HTTP request.'
exit 0
