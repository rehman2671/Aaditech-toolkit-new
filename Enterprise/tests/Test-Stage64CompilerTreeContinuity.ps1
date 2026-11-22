#Requires -Version 5.1
# N64 synthetic Windows regression: no downloads, executable compiler,
# signer certificates, customer configurations or production secrets.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N64 requires a Windows host.' }
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'Enterprise\agent\build\CompilerModuleContinuity.psm1') -Force -ErrorAction Stop
$base=Join-Path ([IO.Path]::GetTempPath()) ('n64-offline-'+[guid]::NewGuid().ToString('N'))
$src=Join-Path $base 'reviewed-extraction'
$dest=Join-Path $base 'installed-module'
$null=[IO.Directory]::CreateDirectory($src)
$null=[IO.Directory]::CreateDirectory($dest)

function Require-N64Blocked {
    param([scriptblock]$Check,[string]$Label)
    $blocked=$false
    try { $null=& $Check }
    catch {
        $blocked=$true
        if ($_.Exception.Message -cne 'N64 compiler module copy or continuity blocked.') {
            throw ('N64 emitted unsafe or unexpected error: '+$Label)
        }
    }
    if (-not $blocked) { throw ('N64 accepted tampered compiler content: '+$Label) }
}

try {
    [IO.File]::WriteAllText((Join-Path $src 'ps2exe.psd1'),'@{ ModuleVersion = "1.0.18" }')
    [IO.File]::WriteAllText((Join-Path $src 'ps2exe.psm1'),'function ps2exe { "fixture" }')
    $null=[IO.Directory]::CreateDirectory((Join-Path $src 'assets'))
    [IO.File]::WriteAllText((Join-Path $src 'assets\payload.txt'),'original companion data')
    Copy-Item -LiteralPath (Join-Path $src 'ps2exe.psd1') -Destination $dest
    Copy-Item -LiteralPath (Join-Path $src 'ps2exe.psm1') -Destination $dest
    Copy-Item -LiteralPath (Join-Path $src 'assets') -Destination $dest -Recurse

    $approved=Assert-N64CompilerModuleCopy -SourceDirectory $src -InstalledDirectory $dest
    if ($approved -cnotmatch '\A[0-9A-F]{64}\z' -or
        (Assert-N64CompilerModuleContinuity -ModuleDirectory $dest -ExpectedSha256 $approved.ToLowerInvariant()) -ne $true) {
        throw 'N64 rejected identical reviewed module tree.'
    }

    $modulePath=Join-Path $dest 'ps2exe.psm1'
    [IO.File]::AppendAllText($modulePath,'; unauthorized edit')
    Require-N64Blocked -Label 'compiler body modified after copy' -Check {
        Assert-N64CompilerModuleContinuity -ModuleDirectory $dest -ExpectedSha256 $approved
    }
    Require-N64Blocked -Label 'compiler body differs from vetted extraction' -Check {
        Assert-N64CompilerModuleCopy -SourceDirectory $src -InstalledDirectory $dest
    }
    Copy-Item -LiteralPath (Join-Path $src 'ps2exe.psm1') -Destination $modulePath -Force

    $dataPath=Join-Path $dest 'assets\payload.txt'
    [IO.File]::AppendAllText($dataPath,'; unauthorized companion edit')
    Require-N64Blocked -Label 'nested compiler dependency altered' -Check {
        Assert-N64CompilerModuleContinuity -ModuleDirectory $dest -ExpectedSha256 $approved
    }
    Copy-Item -LiteralPath (Join-Path $src 'assets\payload.txt') -Destination $dataPath -Force

    $extra=Join-Path $dest 'unexpected.ps1'
    [IO.File]::WriteAllText($extra,'hidden additional module file')
    Require-N64Blocked -Label 'extra executable file' -Check {
        Assert-N64CompilerModuleCopy -SourceDirectory $src -InstalledDirectory $dest
    }
    Remove-Item -LiteralPath $extra -Force

    Remove-Item -LiteralPath $dataPath -Force
    Require-N64Blocked -Label 'missing nested companion dependency' -Check {
        Assert-N64CompilerModuleCopy -SourceDirectory $src -InstalledDirectory $dest
    }
    Copy-Item -LiteralPath (Join-Path $src 'assets\payload.txt') -Destination $dataPath -Force

    Require-N64Blocked -Label 'missing tree SHA' -Check {
        Assert-N64CompilerModuleContinuity -ModuleDirectory $dest -ExpectedSha256 ''
    }
    Require-N64Blocked -Label 'malformed tree SHA' -Check {
        Assert-N64CompilerModuleContinuity -ModuleDirectory $dest -ExpectedSha256 ('0'*63)
    }
    Require-N64Blocked -Label 'wrong tree SHA' -Check {
        Assert-N64CompilerModuleContinuity -ModuleDirectory $dest -ExpectedSha256 ('0'*64)
    }

    # Recheck source-to-installed parity after all tampering was restored.
    if ((Assert-N64CompilerModuleCopy -SourceDirectory $src -InstalledDirectory $dest) -cne $approved) {
        throw 'N64 repaired compiler tree failed independent parity.'
    }

    $install=[IO.File]::ReadAllText((Join-Path $repo 'Enterprise\agent\build\Install-ApprovedCompiler.ps1'))
    $buildLock=[IO.File]::ReadAllText((Join-Path $repo 'Enterprise\agent\build\BuildToolchainLock.psm1'))
    $buildAgent=[IO.File]::ReadAllText((Join-Path $repo 'Enterprise\agent\build\build-agent.ps1'))
    $ci=[IO.File]::ReadAllText((Join-Path $repo '.github\workflows\ci.yml'))
    $installCopy=$install.IndexOf('Assert-N64CompilerModuleCopy -SourceDirectory',[StringComparison]::Ordinal)
    $installEnv=$install.IndexOf('$env:N64_PS2EXE_TREE_SHA256=$approvedTreeDigest',[StringComparison]::Ordinal)
    $installImport=$install.IndexOf('$null=Assert-N62InstalledPs2Exe',[StringComparison]::Ordinal)
    $lockGate=$buildLock.IndexOf('Assert-N64CompilerModuleContinuity -ModuleDirectory $moduleBase',[StringComparison]::Ordinal)
    $lockImport=$buildLock.IndexOf('Import-Module -Name $approvedManifest',[StringComparison]::Ordinal)
    if ($installCopy -lt 0 -or $installEnv -le $installCopy -or $installImport -le $installEnv -or
        $install.IndexOf("'N64_PS2EXE_TREE_SHA256='",[StringComparison]::Ordinal) -lt 0 -or
        $lockGate -lt 0 -or $lockImport -le $lockGate -or
        $buildAgent.IndexOf('$null=Assert-N62InstalledPs2Exe',[StringComparison]::Ordinal) -lt 0 -or
        [regex]::Matches($ci,'Test-Stage64CompilerTreeContinuity\.ps1').Count -ne 2) {
        throw 'N64 protected compiler recheck or dual-host CI wiring missing.'
    }

    Write-Host 'N64 PASS: verified full module copy, compiler/companion tampering, removed/extra files, SHA continuity and protected build admission.'
} finally {
    Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
