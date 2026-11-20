#Requires -Version 5.1
# N46 no-network Windows regression: Windows PowerShell 5.1/.NET Framework
# and PowerShell 7/.NET must both atomically create a protected ACL directory.
# Does not invoke the live probe, curl, DNS, API or real customer endpoints.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N46 tests must run on Windows.' }

$moduleFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\PrivateWindowsProbeWorkspace.psm1'))
$probeFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
$source = [IO.File]::ReadAllText($moduleFile)
$operator = [IO.File]::ReadAllText($probeFile)
$aclSetup = '$acl.SetAccessRuleProtection($true, $false)'
$frameworkCreate = '[IO.Directory]::CreateDirectory($directory, $acl)'
$coreCreate = '[System.IO.FileSystemAclExtensions]::CreateDirectory('
$checkAcl = '$actual = Get-Acl -LiteralPath $directory'
$created = '$createdDirectory = $true'
$dns = '[System.Net.Dns]::GetHostAddresses'
$workspaceCall = '$workspace = New-PrivateWindowsProbeWorkspace'

foreach ($required in @($aclSetup,$frameworkCreate,$coreCreate,$checkAcl,$created)) {
    if ($source.IndexOf($required,[StringComparison]::Ordinal) -lt 0) {
        throw 'N46 atomic ACL creation or ownership tracking is missing.'
    }
}
if ($source.IndexOf($frameworkCreate,[StringComparison]::Ordinal) -lt
      $source.IndexOf($aclSetup,[StringComparison]::Ordinal) -or
    $source.IndexOf($coreCreate,[StringComparison]::Ordinal) -lt
      $source.IndexOf($aclSetup,[StringComparison]::Ordinal) -or
    $source.IndexOf($checkAcl,[StringComparison]::Ordinal) -lt
      $source.IndexOf($coreCreate,[StringComparison]::Ordinal) -or
    $source.IndexOf($created,[StringComparison]::Ordinal) -lt
      $source.IndexOf($coreCreate,[StringComparison]::Ordinal)) {
    throw 'N46 ACL was not prepared before filesystem creation/verification.'
}
foreach ($unsafe in @(
    'Set-Acl -LiteralPath $directory',
    '[IO.Directory]::CreateDirectory($directory)',
    'DirectoryInfo]::new($directory).Create()',
    'GetHostAddresses','curl.exe','Invoke-RestMethod','Invoke-WebRequest','TcpClient'
)) {
    if ($source.IndexOf($unsafe,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'N46 module still performs unsafe post-create ACL or network operation.'
    }
}
if ($operator.IndexOf($workspaceCall,[StringComparison]::Ordinal) -lt 0 -or
    $operator.IndexOf($dns,[StringComparison]::Ordinal) -le
    $operator.IndexOf($workspaceCall,[StringComparison]::Ordinal)) {
    throw 'N46 workspace gate no longer executes before any DNS activity.'
}

Import-Module -Name $moduleFile -Force -ErrorAction Stop
$workspaces = [System.Collections.Generic.List[string]]::new()
$actor = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new(
    [System.Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
$allowed = @($actor.Value,$systemSid.Value)

try {
    for ($i=0; $i -lt 4; $i++) {
        $w = New-PrivateWindowsProbeWorkspace
        $workspaces.Add($w.Directory)
        $dir = Get-Item -LiteralPath $w.Directory -Force -ErrorAction Stop
        if ($dir -isnot [IO.DirectoryInfo] -or
            ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'N46 secure directory was not created as an ordinary directory.'
        }
        $dacl = Get-Acl -LiteralPath $w.Directory -ErrorAction Stop
        if (-not $dacl.AreAccessRulesProtected -or
            -not $dacl.GetOwner([System.Security.Principal.SecurityIdentifier]).Equals($actor)) {
            throw 'N46 atomic directory must have owner-controlled protected ACL.'
        }
        $entries = @($dacl.GetAccessRules($true,$true,
            [System.Security.Principal.SecurityIdentifier]))
        if ($entries.Count -lt 1) { throw 'N46 directory missing ACL entries.' }
        foreach ($rule in $entries) {
            if ($rule.IsInherited -or
                $rule.AccessControlType -ne
                    [System.Security.AccessControl.AccessControlType]::Allow -or
                $allowed -cnotcontains $rule.IdentityReference.Value) {
                throw 'N46 directory ACL included broad/inherited permission.'
            }
        }

        $response = Get-Item -LiteralPath $w.ResponsePath -Force -ErrorAction Stop
        if ($response -isnot [IO.FileInfo] -or $response.Length -ne 0 -or
            ($response.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'N46 response target is missing or unsafe.'
        }
        $fileAcl = Get-Acl -LiteralPath $w.ResponsePath -ErrorAction Stop
        foreach ($rule in @($fileAcl.GetAccessRules($true,$true,
            [System.Security.Principal.SecurityIdentifier]))) {
            if ($rule.AccessControlType -ne
                    [System.Security.AccessControl.AccessControlType]::Allow -or
                $allowed -cnotcontains $rule.IdentityReference.Value) {
                throw 'N46 response inherited unintended ACL principal.'
            }
        }
    }
    if (@($workspaces | Select-Object -Unique).Count -ne 4) {
        throw 'N46 private workspace path was reused.'
    }
    Write-Host 'N46 PASS: atomic protected ACL creation (Windows PS 5.1 / PS7), response file inheritance and no live requests.'
} finally {
    foreach ($path in $workspaces) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}
exit 0
