# Validate that a redistributable MSI contains NO permanent agent credentials.
# A newly installed agent stays inert until authorized per-machine enrollment.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ConfigFile)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ConfigFile -PathType Leaf)) {
    throw "No packaged agent configuration exists: $ConfigFile"
}
$cfg = Get-Content -LiteralPath $ConfigFile -Raw -ErrorAction Stop | ConvertFrom-Json
if ([string]$cfg.deployment_state -cne 'UNENROLLED') {
    throw 'MSI config must start in UNENROLLED state, never with live device credentials.'
}
$uri = $null
if (-not [uri]::TryCreate([string]$cfg.endpoint, [UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -ne 'https') {
    throw 'Agent endpoint must be a valid HTTPS URL.'
}
if ($cfg.enroll_url) {
    $enrollUri = $null
    if (-not [uri]::TryCreate([string]$cfg.enroll_url, [UriKind]::Absolute, [ref]$enrollUri) -or
        $enrollUri.Scheme -ne 'https') {
        throw 'Enrollment URL must use HTTPS.'
    }
}
$restricted = @(
    'token', 'bootstrap_token', 'agent_token', 'device_token', 'api_token',
    'command_signing_key', 'hmac_secret', 'private_key', 'password'
)
foreach ($name in $restricted) {
    $prop = $cfg.PSObject.Properties[$name]
    if ($null -ne $prop -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
        throw "Refusing MSI: credential field '$name' must be absent or empty."
    }
}
Write-Host 'MSI packaging configuration verified: HTTPS, UNENROLLED, no embedded credentials.'
