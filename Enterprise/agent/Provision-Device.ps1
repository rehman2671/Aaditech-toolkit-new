#Requires -Version 5.1
<#
.SYNOPSIS
  Provision a newly installed Aaditech endpoint with a ONE-TIME enrollment code.
.DESCRIPTION
  Run interactively as local Administrator after installing the credential-free
  MSI. The token is never passed as a command-line argument or embedded in MSI.
  The remote server MUST present a chain already trusted by Windows.
  On success the agent exchanges the single-use code for its own device identity
  and deletes the bootstrap token from its runtime config.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ServerUrl,
    [string]$ConfigPath = "$env:ProgramData\ITToolkit-Agent\agent.json",
    [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Provisioning must be run from an elevated Administrator PowerShell session.'
}
$parsed = $null
if (-not [Uri]::TryCreate($ServerUrl,[UriKind]::Absolute,[ref]$parsed) -or
    $parsed.Scheme -ne 'https' -or $parsed.UserInfo -or
    $parsed.Query -or $parsed.Fragment) {
    throw 'Specify the trusted HTTPS server origin, e.g. https://rmm.example.com.'
}
$root = $parsed.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Missing MSI-installed runtime config at $ConfigPath"
}
$dir = Split-Path -Parent $ConfigPath
if (Test-Path (Join-Path $dir 'agent.token')) {
    throw 'This agent is already enrolled. Re-enrollment requires a separately approved rotation workflow.'
}
# Validate the endpoint and Windows certificate trust BEFORE asking for a token.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $status = Invoke-WebRequest -Uri "$root/healthz" -Method Get -TimeoutSec 10 -UseBasicParsing
    if ($status.StatusCode -ne 200) { throw "Server responded $($status.StatusCode)" }
}
catch {
    throw "Server HTTPS/TLS verification failed. Install the trusted CA out-of-band and retry. $($_.Exception.Message)"
}

$secureToken = Read-Host 'Paste the single-use enrollment token (input hidden)' -AsSecureString
$ptr = [IntPtr]::Zero
$token = $null
try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 30) {
        throw 'A valid one-time enrollment token is required.'
    }
    $cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    foreach ($prop in @{
        endpoint = "$root/api/v1/ingest/telemetry"
        enroll_url = "$root/api/v1/agent/enroll"
        token = $token.Trim()
        deployment_state = 'PROVISIONING'
    }.GetEnumerator()) {
        $cfg | Add-Member -MemberType NoteProperty -Name $prop.Key -Value $prop.Value -Force
    }
    $content = $cfg | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($ConfigPath,$content,[Text.Encoding]::UTF8)
}
finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $token = $null
    $secureToken = $null
}
& icacls.exe $dir '/inheritance:r' '/grant:r' 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'NETWORK SERVICE:(OI)(CI)M' '/T' '/C' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to restrict the ProgramData credential directory. Do NOT start the agent until fixed.'
}
Write-Host 'HTTPS origin validated. Protected enrollment config saved.'
Write-Host 'Agent enrollment remains single-use; failed enrollments cannot execute remote commands.'
if ($StartNow) {
    & schtasks.exe /Run /TN ITToolkitAgent | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Scheduled agent start failed. Check Task Scheduler and MSI installation.' }
    Write-Host 'Agent task started. Check protected ProgramData logs for enrollment status.'
} else {
    Write-Host 'Run the ITToolkitAgent scheduled task after reviewing the configuration.'
}
