#Requires -Version 5.1
# N62: no downloads, no compilation, no code signing. All fixtures offline.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N62 toolchain regression requires Windows.' }
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$module=Join-Path $root 'Enterprise\agent\build\BuildToolchainLock.psm1'
$workflow=Join-Path $root '.github\workflows\ci.yml'
$exeBuilder=Join-Path $root 'Enterprise\agent\build\build-agent.ps1'
$msiBuilder=Join-Path $root 'Enterprise\agent\wix\build-msi.ps1'
Import-Module -Name $module -Force -ErrorAction Stop
$lock=Get-N62BuildToolchainLock
if ([string]$lock.ps2exe -cne '1.0.18' -or
    [string]$lock.wix -cne '5.0.2') {
    throw 'N62 changed reviewed source build toolchain lock without release governance.'
}
if ((Assert-N62BuildToolchainVersion -Kind ps2exe -ObservedVersion '1.0.18') -ne $true -or
    (Assert-N62BuildToolchainVersion -Kind wix -ObservedVersion '5.0.2') -ne $true -or
    (Assert-N62BuildToolchainVersion -Kind wix -ObservedVersion '5.0.2+validatedbuildsha') -ne $true) {
    throw 'N62 refuses correct reviewed exact Windows toolchain versions.'
}
foreach($case in @(
    @{Kind='ps2exe';Version='1.0.17'},
    @{Kind='ps2exe';Version='1.0.19'},
    @{Kind='ps2exe';Version='1.0.18.0'},
    @{Kind='ps2exe';Version='1.0.18+unsafe'},
    @{Kind='ps2exe';Version='latest'},
    @{Kind='ps2exe';Version='1.*'},
    @{Kind='ps2exe';Version=''},
    @{Kind='wix';Version='5.0.1'},
    @{Kind='wix';Version='5.0.3'},
    @{Kind='wix';Version='6.0.2'},
    @{Kind='wix';Version='5.*'},
    @{Kind='wix';Version='5.0.2.1'},
    @{Kind='wix';Version='5.0.2+bad/extra'},
    @{Kind='wix';Version=('5.0.2'+[char]10+'6.0.2')},
    @{Kind='wix';Version=''}
)) {
    # Invoke directly in this loop scope: a helper parameter named
    # $Case would mask the loop fixture under PowerShell dynamic scoping.
    $denied=$false
    try {
        $null=Assert-N62BuildToolchainVersion -Kind $case.Kind -ObservedVersion $case.Version
    } catch {
        $denied=$true
        if ($_.Exception.Message -cne 'N62 build toolchain version check blocked.') {
            throw ('N62 leaked unexpected error type for '+$case.Kind)
        }
    }
    if (-not $denied) { throw ('N62 accepted unapproved toolchain: '+$case.Kind) }
}
$ci=[IO.File]::ReadAllText($workflow)
$psSource=[IO.File]::ReadAllText($exeBuilder)
$wixSource=[IO.File]::ReadAllText($msiBuilder)
$installPs='Install-Module -Name ps2exe -RequiredVersion '+$lock.ps2exe+' -Repository PSGallery -Force -Scope CurrentUser'
$installWix='dotnet tool install --global wix --version '+$lock.wix
# Both isolated diagnostic jobs must use the exact reviewed versions.
# Count globally AND within each named job, so duplication in one job cannot
# hide a missing pin in the other. N70 separately audits parsed YAML.
foreach ($jobName in @('agent-build','phase-o-msi-diagnostic')) {
    $jobPattern='(?ms)^  '+[regex]::Escape($jobName)+':\r?$\n(?<body>.*?)(?=^  [a-z0-9-]+:\r?$|\z)'
    $jobMatches=[regex]::Matches($ci,$jobPattern)
    if ($jobMatches.Count -ne 1) { throw 'N62 expected exactly one named diagnostic job.' }
    $body=$jobMatches[0].Groups['body'].Value
    foreach ($command in @($installPs,$installWix)) {
        if ([regex]::Matches($body,'(?m)^\s*run: '+[regex]::Escape($command)+'\r?
    $ci.IndexOf('Install-Module ps2exe -Force',[StringComparison]::Ordinal) -ge 0 -or
    $ci.IndexOf('wix --version "5.*"',[StringComparison]::Ordinal) -ge 0) {
    throw 'N62 Windows CI may have an unpinned EXE or MSI compiler.'
}
$importPs=$psSource.IndexOf('BuildToolchainLock.psm1',[StringComparison]::Ordinal)
$admitPs=$psSource.IndexOf('Assert-N62InstalledPs2Exe',[StringComparison]::Ordinal)
$execPs=$psSource.IndexOf('& ps2exe @compileParams',[StringComparison]::Ordinal)
$importWix=$wixSource.IndexOf('BuildToolchainLock.psm1',[StringComparison]::Ordinal)
$admitWix=$wixSource.IndexOf('Assert-N62InstalledWix',[StringComparison]::Ordinal)
$execWix=$wixSource.IndexOf('& $wix.Source build',[StringComparison]::Ordinal)
if ($importPs -lt 0 -or $admitPs -le $importPs -or $execPs -le $admitPs -or
    $importWix -lt 0 -or $admitWix -le $importWix -or $execWix -le $admitWix) {
    throw 'N62 signed/diagnostic compiler version check is not before build invocation.'
}
Write-Host 'N62 PASS: reviewed exact PS2EXE/WiX pins, no floating CI restore, offline downgrade/upgrade/injected-version rejection and admission before both build operations.'
exit 0
).Count -ne 1) {
            throw 'N62 named Windows build job lacks the exact approved compiler pin.'
        }
    }
}
if ([regex]::Matches($ci,[regex]::Escape($installPs)).Count -ne 2 -or
    [regex]::Matches($ci,[regex]::Escape($installWix)).Count -ne 2 -or
    $ci.IndexOf('Install-Module ps2exe -Force',[StringComparison]::Ordinal) -ge 0 -or
    $ci.IndexOf('wix --version "5.*"',[StringComparison]::Ordinal) -ge 0) {
    throw 'N62 Windows CI may have an unpinned EXE or MSI compiler.'
}
$importPs=$psSource.IndexOf('BuildToolchainLock.psm1',[StringComparison]::Ordinal)
$admitPs=$psSource.IndexOf('Assert-N62InstalledPs2Exe',[StringComparison]::Ordinal)
$execPs=$psSource.IndexOf('& ps2exe @compileParams',[StringComparison]::Ordinal)
$importWix=$wixSource.IndexOf('BuildToolchainLock.psm1',[StringComparison]::Ordinal)
$admitWix=$wixSource.IndexOf('Assert-N62InstalledWix',[StringComparison]::Ordinal)
$execWix=$wixSource.IndexOf('& $wix.Source build',[StringComparison]::Ordinal)
if ($importPs -lt 0 -or $admitPs -le $importPs -or $execPs -le $admitPs -or
    $importWix -lt 0 -or $admitWix -le $importWix -or $execWix -le $admitWix) {
    throw 'N62 signed/diagnostic compiler version check is not before build invocation.'
}
Write-Host 'N62 PASS: reviewed exact PS2EXE/WiX pins, no floating CI restore, offline downgrade/upgrade/injected-version rejection and admission before both build operations.'
exit 0
