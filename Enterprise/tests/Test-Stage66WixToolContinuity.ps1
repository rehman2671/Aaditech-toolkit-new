#Requires -Version 5.1
# N66 offline fake WiX global tool layout. Never install/execute real WiX,
# download packages, or read signing/customer secrets in these tests.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N66 needs Windows for path identity tests.' }
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'Enterprise\agent\build\WixToolContinuity.psm1') -Force -ErrorAction Stop
$work=Join-Path ([IO.Path]::GetTempPath()) ('n66-offline-'+[guid]::NewGuid().ToString('N'))
$toolRoot=Join-Path $work 'user\.dotnet\tools'
$store=Join-Path $toolRoot '.store\wix\5.0.2'
$shim=Join-Path $toolRoot 'wix.exe'
$nested=Join-Path $store 'wix\5.0.2\tools\net8.0\any'
$module=Join-Path $nested 'wix.dll'
$companion=Join-Path $nested 'WixTool.resources.dll'
$added=Join-Path $nested 'unexpected.dll'

function Require-N66Blocked {
    param([string]$Label,[scriptblock]$Action)
    $blocked=$false
    try { $null=& $Action } catch {
        $blocked=$true
        if ($_.Exception.Message -cnotin @(
            'N66 protected WiX tool continuity blocked.',
            'N66 protected WiX tool fingerprint blocked.'
        )) { throw ('N66 rejection leaked unredacted details for '+$Label) }
    }
    if (-not $blocked) { throw ('N66 accepted '+$Label) }
}
function Verify-N66Baseline {
    param($Approved)
    if ((Assert-N66WixToolContinuity -ToolRoot $toolRoot -ToolVersion '5.0.2' -ResolvedCommand $shim -ExpectedStoreSha256 $Approved.StoreSha256 -ExpectedShimSha256 $Approved.ShimSha256) -ne $true) {
        throw 'N66 verified synthetic global WiX tool rejected.'
    }
}

try {
    $null=[IO.Directory]::CreateDirectory($nested)
    [IO.File]::WriteAllText($shim,'synthetic shim identity, never execute')
    [IO.File]::WriteAllText($module,'synthetic WiX package body v1')
    [IO.File]::WriteAllText($companion,'synthetic nested dependency v1')
    $good=Get-N66WixToolFingerprint -ToolRoot $toolRoot -ToolVersion '5.0.2'
    if ($good.StoreSha256 -cnotmatch '\A[0-9A-F]{64}\z' -or
        $good.ShimSha256 -cnotmatch '\A[0-9A-F]{64}\z') {
        throw 'N66 did not produce two full SHA256 digests.'
    }
    Verify-N66Baseline -Approved $good

    Require-N66Blocked 'PATH shadowed wix.exe' {
        Assert-N66WixToolContinuity -ToolRoot $toolRoot -ToolVersion '5.0.2' -ResolvedCommand (Join-Path $work 'fake\wix.exe') -ExpectedStoreSha256 $good.StoreSha256 -ExpectedShimSha256 $good.ShimSha256
    }
    Require-N66Blocked 'missing original store approval' {
        Assert-N66WixToolContinuity -ToolRoot $toolRoot -ToolVersion '5.0.2' -ResolvedCommand $shim -ExpectedStoreSha256 '' -ExpectedShimSha256 $good.ShimSha256
    }
    Require-N66Blocked 'malformed shim digest' {
        Assert-N66WixToolContinuity -ToolRoot $toolRoot -ToolVersion '5.0.2' -ResolvedCommand $shim -ExpectedStoreSha256 $good.StoreSha256 -ExpectedShimSha256 'unreviewed'
    }
    Require-N66Blocked 'different pinned package version' {
        Assert-N66WixToolContinuity -ToolRoot $toolRoot -ToolVersion '5.0.3' -ResolvedCommand $shim -ExpectedStoreSha256 $good.StoreSha256 -ExpectedShimSha256 $good.ShimSha256
    }
    Require-N66Blocked 'missing or unsafe version selector' {
        Get-N66WixToolFingerprint -ToolRoot $toolRoot -ToolVersion '..\5.0.2'
    }

    [IO.File]::WriteAllText($module,'synthetic WiX package body altered')
    Require-N66Blocked 'modified installed WiX binary payload' { Verify-N66Baseline -Approved $good }
    [IO.File]::WriteAllText($module,'synthetic WiX package body v1')
    Verify-N66Baseline -Approved $good

    [IO.File]::WriteAllText($companion,'synthetic nested dependency modified')
    Require-N66Blocked 'modified nested package dependency' { Verify-N66Baseline -Approved $good }
    [IO.File]::WriteAllText($companion,'synthetic nested dependency v1')
    Verify-N66Baseline -Approved $good

    [IO.File]::WriteAllText($added,'unexpected extra installed code')
    Require-N66Blocked 'unexpected added .NET tool payload' { Verify-N66Baseline -Approved $good }
    Remove-Item -LiteralPath $added -Force
    Verify-N66Baseline -Approved $good

    Remove-Item -LiteralPath $companion -Force
    Require-N66Blocked 'deleted installed dependency' { Verify-N66Baseline -Approved $good }
    [IO.File]::WriteAllText($companion,'synthetic nested dependency v1')
    Verify-N66Baseline -Approved $good

    [IO.File]::WriteAllText($shim,'changed wix shim with same filename')
    Require-N66Blocked 'replaced Windows WiX command shim' { Verify-N66Baseline -Approved $good }
    [IO.File]::WriteAllText($shim,'synthetic shim identity, never execute')
    Verify-N66Baseline -Approved $good

    $lockScript=Get-Content -LiteralPath (Join-Path $repo 'Enterprise\agent\build\BuildToolchainLock.psm1') -Raw -ErrorAction Stop
    $installer=Get-Content -LiteralPath (Join-Path $repo 'Enterprise\agent\build\Install-ApprovedCompiler.ps1') -Raw -ErrorAction Stop
    $msi=Get-Content -LiteralPath (Join-Path $repo 'Enterprise\agent\wix\build-msi.ps1') -Raw -ErrorAction Stop
    $ci=Get-Content -LiteralPath (Join-Path $repo '.github\workflows\ci.yml') -Raw -ErrorAction Stop
    $fingerprintPos=$installer.IndexOf('Get-N66WixToolFingerprint -ToolRoot $toolRoot',[StringComparison]::Ordinal)
    $restorePos=$installer.IndexOf('dotnet tool install --global wix',[StringComparison]::Ordinal)
    $installCheckPos=$installer.IndexOf('Assert-N62InstalledWix',[StringComparison]::Ordinal)
    $writeStorePos=$installer.IndexOf("'N66_WIX_STORE_SHA256='+",[StringComparison]::Ordinal)
    $writeShimPos=$installer.IndexOf("'N66_WIX_SHIM_SHA256='+",[StringComparison]::Ordinal)
    $protectPos=$lockScript.IndexOf('Assert-N66WixToolContinuity',[StringComparison]::Ordinal)
    $getCommandPos=$lockScript.IndexOf('Get-Command -Name wix -CommandType Application',[StringComparison]::Ordinal)
    $executePos=$lockScript.IndexOf('(& $command.Source --version',[StringComparison]::Ordinal)
    if ($restorePos -lt 0 -or $fingerprintPos -le $restorePos -or
        $installCheckPos -le $fingerprintPos -or
        $writeStorePos -le $installCheckPos -or $writeShimPos -le $writeStorePos -or
        $getCommandPos -lt 0 -or $protectPos -le $getCommandPos -or
        $executePos -le $protectPos -or
        $lockScript -cnotmatch 'GITHUB_EVENT_NAME -ceq ''workflow_dispatch''' -or
        $msi -cnotmatch 'Assert-N62InstalledWix' -or
        [regex]::Matches($ci,'Test-Stage66WixToolContinuity\.ps1').Count -ne 2) {
        throw 'N66 protected WiX stamp, PATH/store pre-execution gate, or dual-PS CI missing.'
    }
    Write-Host 'N66 PASS: exact WiX shim and full global tool store continuity, negative mutations, protected build gate order.'
} finally {
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
exit 0
