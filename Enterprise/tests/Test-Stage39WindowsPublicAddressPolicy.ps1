#Requires -Version 5.1
# N39 PURE offline regression: fixture IPs only, NO DNS/HTTP or customer data.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path $PSScriptRoot '..\deploy\PublicWindowsAddressPolicy.psm1'
$source = [IO.Path]::GetFullPath($source)
$raw = [IO.File]::ReadAllText($source)
foreach ($untrustedTransport in @('GetHostAddresses', 'Invoke-RestMethod', 'Invoke-WebRequest', 'curl.exe', 'TcpClient')) {
    if ($raw.IndexOf($untrustedTransport,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Unexpected transport in offline public address policy: $untrustedTransport"
    }
}
Import-Module $source -Force

function Assert-Rejected {
    param([string]$HostName, [string[]]$Answers)
    $blocked=$false
    try {
        $result = Get-PublicWindowsAddressPin -DnsHost $HostName -AddressLiterals $Answers -ErrorAction Stop
    } catch {
        $blocked=$true
        # No untrusted DNS answer, hostname or operator credential in the exception.
        $message = [string]$_.Exception.Message
        foreach ($secret in @($HostName) + @($Answers)) {
            if ($secret -and $message.Contains($secret)) { throw 'Denied DNS input leaked in error output.' }
        }
    }
    if (-not $blocked) { throw 'Untrusted hostname/address fixture was accepted.' }
}

$hostName = 'console.aaditech.net'
$good = Get-PublicWindowsAddressPin -DnsHost $hostName -AddressLiterals @('2606:4700:4700::1111','8.8.8.8')
if ($good -cne '8.8.8.8') { throw 'Expected deterministic public IPv4 pin.' }
$good = Get-PublicWindowsAddressPin -DnsHost $hostName -AddressLiterals @('2606:4700:4700::1111')
if ($good -cne '[2606:4700:4700::1111]') { throw 'Expected bracketed public IPv6-only pin.' }
$good = Get-PublicWindowsAddressPin -DnsHost $hostName -AddressLiterals @('8.8.8.8','1.1.1.1')
if ($good -cne '1.1.1.1') { throw 'Expected stable public IPv4 ordering.' }
$good = Get-PublicWindowsAddressPin -DnsHost 'CONSOLE.AADITECH.NET' -AddressLiterals @('8.8.8.8')
if ($good -cne '8.8.8.8') { throw 'Case-insensitive ASCII DNS labels must work.' }

foreach ($ip in @(
    '127.0.0.1','10.0.0.1','172.16.1.1','192.168.4.2',
    '169.254.169.254','100.64.1.1','0.0.0.0','192.0.0.9',
    '192.0.2.1','192.88.99.1','198.18.0.1',
    '198.51.100.4','203.0.113.6','224.0.0.1','255.255.255.255',
    '::1','::','fc00::1','fe80::1','ff02::1',
    '2001:db8::1','2001::1','2002:c0a8:101::1',
    '3fff::1','::ffff:127.0.0.1','::ffff:8.8.8.8','not-an-ip'
)) {
    Assert-Rejected -HostName $hostName -Answers @($ip)
    # Any one disallowed address invalidates the *entire* A/AAAA set.
    Assert-Rejected -HostName $hostName -Answers @('8.8.8.8',$ip)
}

foreach ($invalidHost in @(
    'localhost','a.local','foo.internal','foo.onion','foo.arpa','api.test',
    'example.com','x.example.net','EXAMPLE.ORG','host.invalid',
    '127.0.0.1','[::1]','0x7f.1','a.123',
    'https://console.aaditech.net/','user@console.aaditech.net',
    'bad-.aaditech.net','-bad.aaditech.net','a..aaditech.net',
    'console.aaditech.net:443','console.aaditech.net/path',
    "console`naaditech.net",'täst.aaditech.net'
)) {
    Assert-Rejected -HostName $invalidHost -Answers @('8.8.8.8')
}
Assert-Rejected -HostName $hostName -Answers @()
Write-Host 'N39 PASS: deterministic Windows offline public DNS policy, mixed-answer/metadata/transition negatives, zero transport.'
