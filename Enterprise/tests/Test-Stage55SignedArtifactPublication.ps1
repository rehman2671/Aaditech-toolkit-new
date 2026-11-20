#Requires -Version 5.1
# N55 synthetic local checksum manifest and final publication-gate regression.
# No code signing, publisher key, real MSI, HTTP or customer network used.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N55 requires Windows.' }

$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$modulePath=Join-Path $repoRoot 'Enterprise\agent\build\ReleaseArtifactManifest.psm1'
$scriptPath=Join-Path $repoRoot 'Enterprise\agent\build\Verify-SignedPublication.ps1'
$ciPath=Join-Path $repoRoot '.github\workflows\ci.yml'
Import-Module -Name $modulePath -Force -ErrorAction Stop

$operator=[IO.File]::ReadAllText($scriptPath)
$workflow=[IO.File]::ReadAllText($ciPath)
foreach ($marker in @(
    "GITHUB_EVENT_NAME -cne 'workflow_dispatch'",
    "GITHUB_REF -cne 'refs/heads/main'",
    "RELEASE_SIGNING_ENABLED -cne 'true'",
    "PUBLISH_SIGNED -cne 'true'",
    'CODESIGN_APPROVED_THUMBPRINT',
    'SQLITE3_EXE_SHA256_APPROVED',
    'Assert-N55SignedPublicationManifest',
    'Get-AuthenticodeSignature',
    'TimeStamperCertificate',
    'Assert-N54ApprovedSqliteFile',
    "'PUBLICATION_VERIFIED=true'"
)) {
    if ($operator.IndexOf($marker,[StringComparison]::Ordinal) -lt 0) {
        throw ('N55 final signing boundary missing: '+$marker)
    }
}
$installation=$workflow.IndexOf('Rehearse real Windows MSI install',[StringComparison]::Ordinal)
$upgrade=$workflow.IndexOf('Rehearse Windows MSI major upgrade',[StringComparison]::Ordinal)
$finalCheck=$workflow.IndexOf('Verify final signed artifact publication',[StringComparison]::Ordinal)
$upload=$workflow.IndexOf('Upload verified signed artifacts only',[StringComparison]::Ordinal)
if ($installation -lt 0 -or $upgrade -le $installation -or
    $finalCheck -le $upgrade -or $upload -le $finalCheck -or
    $workflow.IndexOf("env.PUBLICATION_VERIFIED == 'true'",[StringComparison]::Ordinal) -lt 0) {
    throw 'N55 upload is not strictly gated after install, upgrade and final attestation.'
}
function Assert-N55Denied {
    param([scriptblock]$Action,[string]$Case)
    $blocked=$false
    try { $null = & $Action } catch {
        $blocked=$true
        if ($_.Exception.Message -cne 'N55 signed publication manifest blocked.') {
            throw ('N55 disclosed raw artifact data for '+$Case)
        }
    }
    if (-not $blocked) { throw ('N55 wrongly accepted '+$Case) }
}
$dir=Join-Path ([IO.Path]::GetTempPath()) ('n55-ci-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($dir)
$version='1.3.7'
$exe=Join-Path $dir 'IT-Toolkit-Agent.exe'
$msi=Join-Path $dir ('IT-Toolkit-Agent-'+$version+'.msi')
$manifest=Join-Path $dir 'SHA256SUMS.txt'
$extraMsi=Join-Path $dir 'IT-Toolkit-Agent-1.3.8.msi'
$sha=$null
try {
    [IO.File]::WriteAllBytes($exe,[Text.Encoding]::ASCII.GetBytes('N55-synthetic-EXE'))
    [IO.File]::WriteAllBytes($msi,[Text.Encoding]::ASCII.GetBytes('N55-synthetic-MSI'))
    $sha=[Security.Cryptography.SHA256]::Create()
    $exeHash=[BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($exe))).Replace('-','').ToLowerInvariant()
    $msiHash=[BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($msi))).Replace('-','').ToLowerInvariant()
    $lf=[string][char]10
    $crlf=[string][char]13+$lf
    $line1=$exeHash+'  IT-Toolkit-Agent.exe'
    $line2=$msiHash+'  IT-Toolkit-Agent-'+$version+'.msi'
    function Set-N55Manifest([string]$Text) {
        [IO.File]::WriteAllBytes($manifest,[Text.Encoding]::ASCII.GetBytes($Text))
    }
    Set-N55Manifest ($line1+$crlf+$line2+$crlf)
    if ((Assert-N55SignedPublicationManifest -OutputDirectory $dir -ExpectedAgentVersion $version) -ne $true) {
        throw 'N55 synthetic canonical CRLF manifest rejected.'
    }
    Set-N55Manifest ($line1+$lf+$line2+$lf)
    if ((Assert-N55SignedPublicationManifest -OutputDirectory $dir -ExpectedAgentVersion $version) -ne $true) {
        throw 'N55 synthetic canonical LF manifest rejected.'
    }
    foreach ($wrong in @(
        $line1+$crlf+$line2,
        $line2+$lf+$line1+$lf,
        $line1+$lf+$line1+$lf+$line2+$lf,
        $line1+$lf+$line2+$lf+'# extra'+$lf,
        $line1+$lf+$line2+$lf+$line2+$lf,
        ($line1.Replace($exeHash,('f'*64))+$lf+$line2+$lf),
        ($line1+$lf+$line2.Replace($msiHash,('0'*64))+$lf),
        $line1+[string][char]13+$line2+$lf
    )) {
        Set-N55Manifest $wrong
        Assert-N55Denied -Case 'malformed, wrong-order, duplicate or mutated manifest' -Action {
            Assert-N55SignedPublicationManifest -OutputDirectory $dir -ExpectedAgentVersion $version
        }
    }
    Set-N55Manifest ($line1+$lf+$line2+$lf)
    Assert-N55Denied -Case 'wrong candidate product version' -Action {
        Assert-N55SignedPublicationManifest -OutputDirectory $dir -ExpectedAgentVersion '1.3.8'
    }
    Assert-N55Denied -Case 'malformed candidate version' -Action {
        Assert-N55SignedPublicationManifest -OutputDirectory $dir -ExpectedAgentVersion '../1.3.7'
    }
    [IO.File]::WriteAllBytes($extraMsi,[Text.Encoding]::ASCII.GetBytes('N55-extra-MSI'))
    Assert-N55Denied -Case 'second release MSI candidate' -Action {
        Assert-N55SignedPublicationManifest -OutputDirectory $dir -ExpectedAgentVersion $version
    }
    Remove-Item -LiteralPath $extraMsi -Force
    [IO.File]::WriteAllBytes($exe,[Text.Encoding]::ASCII.GetBytes('N55-synthetic-EXE-mutated'))
    Assert-N55Denied -Case 'signed executable changed after manifest' -Action {
        Assert-N55SignedPublicationManifest -OutputDirectory $dir -ExpectedAgentVersion $version
    }
    [IO.File]::WriteAllBytes($exe,[Text.Encoding]::ASCII.GetBytes('N55-synthetic-EXE'))
    [IO.File]::WriteAllBytes($msi,[Text.Encoding]::ASCII.GetBytes('N55-synthetic-MSI-mutated'))
    Assert-N55Denied -Case 'signed MSI changed after manifest' -Action {
        Assert-N55SignedPublicationManifest -OutputDirectory $dir -ExpectedAgentVersion $version
    }
    Write-Host 'N55 PASS: immutable two-artifact release manifests reject mutation, extras, wrong order/version, malformed bytes and publication bypass.'
} finally {
    if ($null -ne $sha) { $sha.Dispose() }
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
