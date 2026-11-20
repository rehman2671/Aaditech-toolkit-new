#Requires -Version 5.1
# N45 Windows-only OFFLINE test. No valid live consent / DNS / HTTP / curl.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N45 filesystem ACL tests require actual Windows.' }

$modulePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\deploy\PrivateWindowsProbeWorkspace.psm1'))
$scriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
$source = [IO.File]::ReadAllText($modulePath)
$liveSource = [IO.File]::ReadAllText($scriptPath)

foreach ($badOperation in @('GetHostAddresses','Invoke-WebRequest','Invoke-RestMethod','curl.exe','TcpClient')) {
    if ($source.IndexOf($badOperation,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'Private workspace module may not access DNS, sockets or native curl.'
    }
}
$workspaceCall = '$workspace = New-PrivateWindowsProbeWorkspace'
$dnsCall = '[System.Net.Dns]::GetHostAddresses'
if ($liveSource.IndexOf($workspaceCall,[StringComparison]::Ordinal) -lt 0 -or
    $liveSource.IndexOf($dnsCall,[StringComparison]::Ordinal) -le
    $liveSource.IndexOf($workspaceCall,[StringComparison]::Ordinal)) {
    throw 'Private workspace must be enforced before any live DNS request.'
}
$legacy = "Join-Path ([IO.Path]::GetTempPath())"
if ($liveSource.IndexOf($legacy,[StringComparison]::Ordinal) -ge 0) {
    throw 'Live probe still uses unprotected random directory under TEMP.'
}

Import-Module -Name $modulePath -Force -ErrorAction Stop
$oldTemp = [Environment]::GetEnvironmentVariable('TEMP','Process')
$oldTmp = [Environment]::GetEnvironmentVariable('TMP','Process')
$maliciousParent = Join-Path ([IO.Path]::GetTempPath()) ('aaditech-n45-public-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($maliciousParent) | Out-Null
$workspaces = [System.Collections.Generic.List[string]]::new()
try {
    [Environment]::SetEnvironmentVariable('TEMP',$maliciousParent,'Process')
    [Environment]::SetEnvironmentVariable('TMP',$maliciousParent,'Process')
    for ($i=0; $i -lt 3; $i++) {
        $w = New-PrivateWindowsProbeWorkspace
        $workspaces.Add($w.Directory)
        if (-not [IO.Path]::IsPathRooted($w.Directory) -or
            $w.Directory.StartsWith($maliciousParent,[StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $w.Directory -PathType Container) -or
            -not (Test-Path -LiteralPath $w.ResponsePath -PathType Leaf)) {
            throw 'N45 private directory is missing or inherits caller-injected TEMP.'
        }
        $responseFile = Get-Item -LiteralPath $w.ResponsePath -Force
        if ($responseFile.Length -ne 0 -or
            ($responseFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            [IO.Path]::GetDirectoryName($w.ResponsePath) -cne $w.Directory) {
            throw 'N45 response file must be an ordinary empty exclusive file.'
        }
        $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $system = [System.Security.Principal.SecurityIdentifier]::new(
            [System.Security.Principal.WellKnownSidType]::LocalSystemSid,$null)
        $acl = Get-Acl -LiteralPath $w.Directory -ErrorAction Stop
        if (-not $acl.AreAccessRulesProtected -or
            -not $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Equals($owner)) {
            throw 'N45 directory owner mismatch or inherited ACL.'
        }
        $rules = @($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
        if ($rules.Count -lt 1) { throw 'N45 private directory lacks ACL rules.' }
        foreach ($rule in $rules) {
            if ($rule.IsInherited -or
                $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
                @($owner.Value,$system.Value) -cnotcontains $rule.IdentityReference.Value) {
                throw 'N45 private directory allows a foreign user or inherited permission.'
            }
        }

        # Curl is the only intended writer and should receive the preallocated
        # response path. Prove repeat exclusive creation cannot overwrite it.
        $recreated = $false
        try {
            $fd = [IO.File]::Open($w.ResponsePath,[IO.FileMode]::CreateNew,
                [IO.FileAccess]::Write,[IO.FileShare]::None)
            $fd.Dispose()
        } catch [System.IO.IOException] {
            $recreated = $true
        }
        if (-not $recreated) {
            throw 'N45 response file was unexpectedly overwritten by CreateNew.'
        }
    }
    if (@($workspaces | Select-Object -Unique).Count -ne 3) {
        throw 'N45 private directories must be unique per invocation.'
    }
    Write-Host 'N45 PASS: account-local private workspace, explicit owner/SYSTEM ACL, no unsafe TEMP or live network.'
} finally {
    [Environment]::SetEnvironmentVariable('TEMP',$oldTemp,'Process')
    [Environment]::SetEnvironmentVariable('TMP',$oldTmp,'Process')
    foreach ($w in $workspaces) {
        Remove-Item -LiteralPath $w -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $maliciousParent -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
