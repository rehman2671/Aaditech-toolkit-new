#Requires -Version 5.1
# N64: offline synthetic PS2EXE payload, no downloads, code-signing keys,
# production runner or real compiler import. Windows PS 5.1 and PS 7.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N64 requires real Windows.' }
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'Enterprise\agent\build\ApprovedCompilerPayload.psm1') -Force -ErrorAction Stop
$installer=[IO.File]::ReadAllText((Join-Path $repo 'Enterprise\agent\build\Install-ApprovedCompiler.ps1'))
$admission=[IO.File]::ReadAllText((Join-Path $repo 'Enterprise\agent\build\BuildToolchainLock.psm1'))
$ci=[IO.File]::ReadAllText((Join-Path $repo '.github\workflows\ci.yml'))
$dir=Join-Path ([IO.Path]::GetTempPath()) ('n64-audit-'+[guid]::NewGuid().ToString('N'))
$source=Join-Path $dir 'source'
$installed=Join-Path $dir 'installed'
$null=[IO.Directory]::CreateDirectory($source)
$null=[IO.Directory]::CreateDirectory($installed)
function Deny-N64 {
    param([scriptblock]$Check,[string]$Label)
    $failed=$false
    try { $null=& $Check } catch {
        $failed=$true
        if ($_.Exception.Message -cne 'N64 verified PS2EXE payload admission blocked.') {
            throw ('N64 emitted unexpected or sensitive error: '+$Label)
        }
    }
    if (-not $failed) { throw ('N64 accepted modified compiler payload: '+$Label) }
}
try {
    [IO.File]::WriteAllText((Join-Path $source 'ps2exe.psd1'),'@{ModuleVersion="1.0.18"}')
    [IO.File]::WriteAllText((Join-Path $source 'ps2exe.psm1'),'function Invoke-Approved { "safe" }')
    $null=[IO.Directory]::CreateDirectory((Join-Path $source 'nested'))
    [IO.File]::WriteAllText((Join-Path $source 'nested\resource.txt'),'synthetic dependency')
    Copy-Item -Path (Join-Path $source '*') -Destination $installed -Force -Recurse
    $digest=Get-N64Ps2ExePayloadDigest -Directory $source
    if ($digest -cnotmatch '\A[0-9A-F]{64}\z' -or
        (Assert-N64ApprovedPs2ExePayload -Directory $installed -ApprovedSha256 $digest.ToLowerInvariant()) -ne $true) {
        throw 'N64 authentic synthetic payload mismatch.'
    }

    # The manifest stays identical: tamper only with actual compiler code.
    [IO.File]::AppendAllText((Join-Path $installed 'ps2exe.psm1'),'# injection')
    Deny-N64 -Label 'post-copy compiler source tampering' -Check {
        Assert-N64ApprovedPs2ExePayload -Directory $installed -ApprovedSha256 $digest
    }
    Copy-Item -LiteralPath (Join-Path $source 'ps2exe.psm1') -Destination (Join-Path $installed 'ps2exe.psm1') -Force
    [IO.File]::WriteAllText((Join-Path $installed 'unexpected.ps1'),'unapproved addition')
    Deny-N64 -Label 'extra unreviewed source file' -Check {
        Assert-N64ApprovedPs2ExePayload -Directory $installed -ApprovedSha256 $digest
    }
    Remove-Item -LiteralPath (Join-Path $installed 'unexpected.ps1') -Force
    Remove-Item -LiteralPath (Join-Path $installed 'nested\resource.txt') -Force
    Deny-N64 -Label 'removed dependency file' -Check {
        Assert-N64ApprovedPs2ExePayload -Directory $installed -ApprovedSha256 $digest
    }
    Copy-Item -LiteralPath (Join-Path $source 'nested\resource.txt') -Destination (Join-Path $installed 'nested\resource.txt') -Force
    Deny-N64 -Label 'missing handoff fingerprint' -Check {
        Assert-N64ApprovedPs2ExePayload -Directory $installed -ApprovedSha256 ''
    }
    Deny-N64 -Label 'wrong handoff fingerprint' -Check {
        Assert-N64ApprovedPs2ExePayload -Directory $installed -ApprovedSha256 ('0'*64)
    }
    $linked=Join-Path $installed 'linked.ps1'
    $symlinkCreated=$false
    try {
        $null=New-Item -ItemType SymbolicLink -Path $linked -Target (Join-Path $source 'ps2exe.psm1') -ErrorAction Stop
        $symlinkCreated=$true
    } catch {
        Write-Host 'N64 symbolic-link fixture unavailable on this Windows runner; other tamper cases remain enforced.'
    }
    if ($symlinkCreated) {
        Deny-N64 -Label 'symlink payload entry' -Check {
            Assert-N64ApprovedPs2ExePayload -Directory $installed -ApprovedSha256 $digest
        }
        Remove-Item -LiteralPath $linked -Force
    }
    if ((Assert-N64ApprovedPs2ExePayload -Directory $installed -ApprovedSha256 $digest) -ne $true) {
        throw 'N64 cannot accept restored valid payload.'
    }

    # Source-order guards: source digest after vetted archive extraction,
    # verified whole copy before module import, explicit GitHub env bridge,
    # and full payload fingerprint checked before protected Import-Module.
    $extract=$installer.IndexOf('Expand-Archive -LiteralPath $zip',[StringComparison]::Ordinal)
    $sourceDigest=$installer.IndexOf('Get-N64Ps2ExePayloadDigest -Directory $manifests[0].Directory.FullName',[StringComparison]::Ordinal)
    $copy=$installer.IndexOf('Copy-Item -LiteralPath $entry.FullName -Destination $destination',[StringComparison]::Ordinal)
    $copyGate=$installer.IndexOf('Assert-N64ApprovedPs2ExePayload -Directory $destination',[StringComparison]::Ordinal)
    $installImport=$installer.IndexOf('Assert-N62InstalledPs2Exe',[StringComparison]::Ordinal)
    $bridge=$installer.IndexOf('N64_PS2EXE_PAYLOAD_SHA256=''+$payloadDigest',[StringComparison]::Ordinal)
    $admitHash=$admission.IndexOf('Assert-N64ApprovedPs2ExePayload -Directory $moduleBase',[StringComparison]::Ordinal)
    $moduleImport=$admission.IndexOf('Import-Module -Name $approvedManifest',[StringComparison]::Ordinal)
    if ($extract -lt 0 -or $sourceDigest -le $extract -or
        $copy -le $sourceDigest -or $copyGate -le $copy -or
        $installImport -le $copyGate -or $bridge -le $copyGate -or
        $admitHash -lt 0 -or $moduleImport -le $admitHash -or
        $ci.IndexOf('Test-Stage64ApprovedCompilerPayload.ps1',[StringComparison]::Ordinal) -lt 0) {
        throw 'N64 source ordering or next-step SHA handoff absent.'
    }
    Write-Host 'N64 PASS: full extracted compiler payload identity, post-copy tamper/add/remove/symlink rejection and pre-import SHA continuity.'
} finally {
    if (Test-Path -LiteralPath $dir) {
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
exit 0
