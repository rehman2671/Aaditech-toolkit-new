#Requires -Version 5.1
# Phase N55: protected *final* publication boundary. Must run immediately
# before upload-artifact, after MSI installation/major upgrade rehearsals.
# No network, signing, PFX loading, or publication if prerequisites fail.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:GITHUB_ACTIONS -cne 'true' -or
    $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
    $env:GITHUB_REF -cne 'refs/heads/main' -or
    $env:RELEASE_SIGNING_ENABLED -cne 'true' -or
    $env:PUBLISH_SIGNED -cne 'true' -or
    [string]::IsNullOrWhiteSpace($env:GITHUB_ENV) -or
    [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    throw 'N55 final publication requires reviewed manual main signing context.'
}
# No signing certificate or private key is inferred or loaded locally.
$approved = [string]$env:CODESIGN_APPROVED_THUMBPRINT
if ($approved -cnotmatch '\A[A-Fa-f0-9]{40}\z' -or
    $env:SQLITE3_EXE_SHA256_APPROVED -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
    throw 'N55 independent publisher and SQLite release approvals required.'
}
$approved=$approved.ToUpperInvariant()

Import-Module -Name (Join-Path $PSScriptRoot 'ReleaseArtifactManifest.psm1') -Force -ErrorAction Stop
Import-Module -Name (Join-Path $PSScriptRoot '..\wix\SqliteBundleApproval.psm1') -Force -ErrorAction Stop
$versionFile = Join-Path $PSScriptRoot '..\agent-version.json'
$version = [string]((Get-Content -LiteralPath $versionFile -Raw |
    ConvertFrom-Json).agent_version)
$out = Join-Path $PSScriptRoot 'out'
$exe = Join-Path $out 'IT-Toolkit-Agent.exe'
$msi = Join-Path $out ("IT-Toolkit-Agent-$version.msi")
$null = Assert-N55SignedPublicationManifest -OutputDirectory $out -ExpectedAgentVersion $version

$sdk = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits\10\bin'
$signTool = Get-ChildItem -LiteralPath $sdk -Recurse -File -Filter 'signtool.exe' -ErrorAction Stop |
    Where-Object { $_.FullName -match '\d+\.\d+\.\d+\.\d+\\x64' } |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signTool) { throw 'N55 Windows SDK signature verifier unavailable.' }
function Assert-N55Authenticode {
    param([string]$File)
    # An SHA manifest can be rewritten alongside altered artifacts. Require
    # the independently approved publisher and trusted timestamp as well.
    $null = & $signTool.FullName verify /pa $File 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'N55 OS-trusted publisher signature absent.' }
    $signature=Get-AuthenticodeSignature -LiteralPath $File -ErrorAction Stop
    if ($signature.Status -ne 'Valid' -or
        $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -cne $approved -or
        $null -eq $signature.TimeStamperCertificate) {
        throw 'N55 publisher or RFC3161 timestamp approval blocked.'
    }
}
Assert-N55Authenticode -File $exe
Assert-N55Authenticode -File $msi

# Re-extract the EXACT signed MSI that will be uploaded rather than trusting
# the N54 pre-signing extract. Later install/upgrade test steps could replace
# build outputs. Treat an unapproved embedded SQLite binary as BLOCKED.
$recheckDir = Join-Path $env:RUNNER_TEMP ('n55-publish-'+[guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($recheckDir)
try {
    $extract = Join-Path $recheckDir 'msi-extracted'
    $null = [IO.Directory]::CreateDirectory($extract)
    $log=Join-Path $recheckDir 'msi-admin.log'
    $arguments = ('/a "{0}" /qn TARGETDIR="{1}" /l*v "{2}"' -f $msi,$extract,$log)
    $process = Start-Process -FilePath msiexec.exe -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw 'N55 final MSI administrative extraction failed.'
    }
    $sqlite = @(Get-ChildItem -LiteralPath $extract -Recurse -File -Filter 'sqlite3.exe')
    $embeddedExe = @(Get-ChildItem -LiteralPath $extract -Recurse -File -Filter 'IT-Toolkit-Agent.exe')
    if ($sqlite.Count -ne 1 -or $embeddedExe.Count -ne 1) {
        throw 'N55 final MSI payload count mismatch.'
    }
    $null = Assert-N54ApprovedSqliteFile -Path $sqlite[0].FullName -Kind Executable -ApprovedSha256 $env:SQLITE3_EXE_SHA256_APPROVED
    $embeddedDigest=(Get-FileHash -LiteralPath $embeddedExe[0].FullName -Algorithm SHA256).Hash
    $releaseDigest=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    if ($embeddedDigest -cne $releaseDigest) {
        throw 'N55 MSI does not embed approved signed EXE bytes.'
    }
    # The upload also carries a generic setup template OUTSIDE the signed
    # MSI, so verify it and every agent.json in the extracted signed MSI are
    # still entirely unprovisioned. Never publish a token or hostname.
    $configs = @((Join-Path $out 'agent-config.json')) +
        @(Get-ChildItem -LiteralPath $extract -Recurse -File -Filter 'agent.json' |
            ForEach-Object { $_.FullName })
    if ($configs.Count -lt 2) { throw 'N55 setup template missing.' }
    foreach ($configPath in $configs) {
        $cfg = Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop |
            ConvertFrom-Json -ErrorAction Stop
        if ($cfg.needs_setup -ne $true -or
            -not [string]::IsNullOrEmpty([string]$cfg.endpoint) -or
            -not [string]::IsNullOrEmpty([string]$cfg.enroll_url) -or
            -not [string]::IsNullOrEmpty([string]$cfg.token) -or
            -not [string]::IsNullOrEmpty([string]$cfg.bootstrap_token)) {
            throw 'N55 refuses provisioned configuration in release output.'
        }
    }
    # Final time-of-use checks, after unpacking and before authorizing upload.
    $null = Assert-N55SignedPublicationManifest -OutputDirectory $out -ExpectedAgentVersion $version
    Assert-N55Authenticode -File $exe
    Assert-N55Authenticode -File $msi
    'PUBLICATION_VERIFIED=true' | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
    Write-Host 'N55 final signed publication gate PASS. Protected upload may proceed.'
} finally {
    if (Test-Path -LiteralPath $recheckDir) {
        Remove-Item -LiteralPath $recheckDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
