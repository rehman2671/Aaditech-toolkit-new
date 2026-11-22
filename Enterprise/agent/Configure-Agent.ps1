#Requires -Version 5.1
<#
.SYNOPSIS
  Configure or reconfigure the installed IT-Toolkit Windows agent.
.DESCRIPTION
  Run elevated after MSI installation, when the actual server hostname and
  administrator-issued single-use enrollment token are available. No server
  address or token needs to be baked into the MSI.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\IT-Toolkit\Configure-Agent.ps1"
.EXAMPLE
  .\Configure-Agent.ps1 -ServerUrl https://toolkit.example.com -TokenFile C:\Secure\bootstrap.txt -NonInteractive -TestConnection
#>
[CmdletBinding()]
param(
    [string]$ServerUrl,
    [string]$TokenFile,
    [System.Security.SecureString]$EnrollmentToken,
    [string]$ConfigPath = (Join-Path $env:ProgramData 'ITToolkit-Agent\agent.json'),
    [switch]$NonInteractive,
    [switch]$TestConnection,
    [switch]$ClearRegistryOverride
)

$ErrorActionPreference = 'Stop'
# Writing ProgramData and the machine-wide configuration is an elevated
# operation. Reject before reading a secret or creating any files.
if ($env:OS -eq 'Windows_NT') {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run Configure-Agent.ps1 in an elevated Administrator PowerShell session.'
    }
}
if (-not $ConfigPath) { throw 'Agent configuration path is required.' }

$dir = Split-Path -Parent $ConfigPath
if (-not $dir) { throw 'Agent configuration must have a parent directory.' }
$old = @{}
if (Test-Path -LiteralPath $ConfigPath) {
    $raw = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    foreach ($p in $raw.PSObject.Properties) { $old[$p.Name] = $p.Value }
}

if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
    if ($NonInteractive) { throw '-ServerUrl is required in -NonInteractive mode.' }
    $previous = if ($old.ContainsKey('endpoint') -and $old['endpoint']) {
        ([uri]$old['endpoint']).GetLeftPart([UriPartial]::Authority)
    } else { '' }
    $ServerUrl = Read-Host "HTTPS server URL (e.g. https://toolkit.example.com) [$previous]"
    if (-not $ServerUrl) { $ServerUrl = $previous }
}
$ServerUrl = $ServerUrl.Trim().TrimEnd('/')
$uri = $null
if (-not [uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -ne 'https' -or
    [string]::IsNullOrWhiteSpace($uri.Host) -or
    -not [string]::IsNullOrEmpty($uri.UserInfo) -or
    $uri.AbsolutePath -ne '/' -or
    -not [string]::IsNullOrEmpty($uri.Query) -or
    -not [string]::IsNullOrEmpty($uri.Fragment)) {
    throw 'Provide an HTTPS origin only (https://host[:port]); no credentials, path, query or fragment.'
}
$base = $uri.GetLeftPart([UriPartial]::Authority)

$token = ''
if ($TokenFile -and $EnrollmentToken) {
    throw 'Choose either -TokenFile or -EnrollmentToken, never both.'
}
if ($TokenFile) {
    if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) {
        throw "Token file not found: $TokenFile"
    }
    $token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
} else {
    if (-not $EnrollmentToken -and $NonInteractive) {
        throw '-TokenFile or -EnrollmentToken is required in -NonInteractive mode.'
    }
    $secure = if ($EnrollmentToken) { $EnrollmentToken } else {
        Read-Host 'Single-use enrollment token (hidden)' -AsSecureString
    }
    $ptr = [IntPtr]::Zero
    try {
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        if (-not $EnrollmentToken) { $secure.Dispose() }
    }
}
if ([string]::IsNullOrWhiteSpace($token) -or
    $token.Length -lt 12 -or
    $token -match '\s') {
    throw 'Enrollment token must be at least 12 non-whitespace characters.'
}

$reg = 'HKLM:\SOFTWARE\ITToolkit\Agent'
if (Test-Path $reg) {
    $override = Get-ItemProperty -Path $reg -ErrorAction Stop
    # MSI writes Installed=<version> into this key; the optional EndpointUrl
    # and ApiToken values are absent until a managed policy supplies them.
    # Property access must be safe even under Set-StrictMode -Version Latest.
    $endpointValue = $override.PSObject.Properties['EndpointUrl']
    $tokenValue = $override.PSObject.Properties['ApiToken']
    if ((($endpointValue -and $endpointValue.Value) -or
         ($tokenValue -and $tokenValue.Value)) -and -not $ClearRegistryOverride) {
        throw 'Registry EndpointUrl/ApiToken override exists and would mask this setup. Remove it via authorized policy or rerun with -ClearRegistryOverride.'
    }
}
if ($TestConnection) {
    # No -SkipCertificateCheck: a real trusted HTTPS server is mandatory.
    $response = Invoke-RestMethod -Uri "$base/healthz" -TimeoutSec 10
    if ($response.status -ne 'ok' -or $response.components.database -ne 'HEALTHY') {
        throw "Server health check failed: HTTPS must be valid and MySQL must report HEALTHY at $base"
    }
}

$newEndpoint = "$base/api/v1/ingest/telemetry"
$oldEndpoint = if ($old.ContainsKey('endpoint')) { [string]$old['endpoint'] } else { '' }
$oldToken = if ($old.ContainsKey('token')) { [string]$old['token'] } else { '' }
$resetDeviceIdentity = ($newEndpoint -ne $oldEndpoint) -or ($token -ne $oldToken)
$old['endpoint'] = $newEndpoint
$old['enroll_url'] = "$base/api/v1/agent/enroll"
$old['poll_url'] = "$base/api/commands/poll?hostname="
$old['token'] = $token
$old['bootstrap_token'] = $token
$old['needs_setup'] = $false
if (-not $old.ContainsKey('features')) { $old['features'] = @() }
if (-not $old.ContainsKey('run_script_allowlist')) { $old['run_script_allowlist'] = @() }
if (-not $old.ContainsKey('interval_minutes')) { $old['interval_minutes'] = 30 }

# A secret must NEVER be written to a broadly readable inherited ACL and
# hardened only afterwards. Remove inherited AND previously explicit access
# from both the directory and secret-bearing files before bytes are written.
# Retain the file owner while replacing the DACL with trusted SID grants.
function Set-PrivateAgentAcl([string]$Path, [bool]$IsDirectory) {
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($entry in @($acl.Access)) {
        $acl.PurgeAccessRules($entry.IdentityReference)
    }
    $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
               [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($grant in @(
        @{ Sid = 'S-1-5-18'; Rights = [System.Security.AccessControl.FileSystemRights]::FullControl },
        @{ Sid = 'S-1-5-32-544'; Rights = [System.Security.AccessControl.FileSystemRights]::FullControl },
        @{ Sid = 'S-1-5-20'; Rights = [System.Security.AccessControl.FileSystemRights]::Modify }
    )) {
        $sid = [System.Security.Principal.SecurityIdentifier]::new($grant.Sid)
        $allow = if ($IsDirectory) {
            [System.Security.AccessControl.FileSystemAccessRule]::new(
                $sid, $grant.Rights, $inherit,
                [System.Security.AccessControl.PropagationFlags]::None,
                [System.Security.AccessControl.AccessControlType]::Allow
            )
        } else {
            [System.Security.AccessControl.FileSystemAccessRule]::new(
                $sid, $grant.Rights, [System.Security.AccessControl.AccessControlType]::Allow
            )
        }
        $acl.AddAccessRule($allow)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop
    $verified = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (-not $verified.AreAccessRulesProtected -or
        @($verified.Access).Count -ne 3) {
        throw 'Agent credential ACL is not verifiably private; refusing to save secrets.'
    }
    foreach ($entry in $verified.Access) {
        $sid = $entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if ($entry.IsInherited -or $entry.AccessControlType -ne 'Allow' -or
            $sid -notin @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-20')) {
            throw 'Agent credential ACL contains unapproved permissions.'
        }
    }
}
if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
if ($env:OS -eq 'Windows_NT') {
    Set-PrivateAgentAcl -Path $dir -IsDirectory $true
    # Existing config may have been given an explicit Everyone/User grant by
    # an older installer or local administrator. Seal it before replacement.
    if (Test-Path -LiteralPath $ConfigPath) {
        Set-PrivateAgentAcl -Path $ConfigPath -IsDirectory $false
    }
}
$temp = Join-Path $dir ("agent.json.tmp." + [guid]::NewGuid().ToString('N'))
$backup = Join-Path $dir ("agent.json.backup." + [guid]::NewGuid().ToString('N'))
$writeSucceeded = $false
try {
    # Create an EMPTY temp file; apply private ACL before placing the token
    # into it. The parent directory is private before this file exists.
    [System.IO.File]::WriteAllBytes($temp, [byte[]]@())
    if ($env:OS -eq 'Windows_NT') {
        Set-PrivateAgentAcl -Path $temp -IsDirectory $false
    }
    $json = $old | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($temp, $json, ([System.Text.UTF8Encoding]::new($false)))
    if (Test-Path -LiteralPath $ConfigPath) {
        # File.Replace keeps an actual recovery backup until success.
        # Both its original and replacement files already have private ACLs.
        [System.IO.File]::Replace($temp, $ConfigPath, $backup)
    } else {
        [System.IO.File]::Move($temp, $ConfigPath)
    }
    if ($env:OS -eq 'Windows_NT') {
        Set-PrivateAgentAcl -Path $ConfigPath -IsDirectory $false
    }
    $writeSucceeded = $true
} finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
    if ($writeSucceeded -and (Test-Path -LiteralPath $backup)) {
        Remove-Item -LiteralPath $backup -Force
    }
}
if ($ClearRegistryOverride -and (Test-Path $reg)) {
    Remove-ItemProperty -Path $reg -Name EndpointUrl -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $reg -Name ApiToken -ErrorAction SilentlyContinue
}
if ($resetDeviceIdentity) {
    foreach ($name in @('agent.token', 'agent.identity.json', 'client.pfx', 'ca.crt')) {
        $stale = Join-Path $dir $name
        if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Force }
    }
}
Write-Host "Agent configured for $base. Token saved locally; it was not printed."
Write-Host 'Re-run this script as Administrator to change the server later.'
if ($resetDeviceIdentity) {
    Write-Host 'Previous per-device credentials cleared; next agent run will re-enroll.'
}
