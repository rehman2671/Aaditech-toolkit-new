#Requires -Version 5.1
# N65: offline synthetic NUPKG ZIP-entry security tests only. No downloaded
# packages, compiler execution, code-signing secrets or customer endpoints.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N65 requires a Windows test runner.' }
Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'Enterprise\agent\build\CompilerArchiveSafety.psm1') -Force -ErrorAction Stop
$work=Join-Path ([IO.Path]::GetTempPath()) ('n65-offline-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($work)
$counter=0

function New-N65Zip {
    param([object[]]$Entries)
    $script:counter++
    $path=Join-Path $work ('sample-'+$script:counter+'.nupkg')
    $file=$null
    $zip=$null
    try {
        $file=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $zip=[IO.Compression.ZipArchive]::new($file,[IO.Compression.ZipArchiveMode]::Create,$true)
        foreach ($record in $Entries) {
            $entry=$zip.CreateEntry([string]$record.name,[IO.Compression.CompressionLevel]::Optimal)
            if ($record.ContainsKey('external')) {
                $entry.ExternalAttributes=[int]$record.external
            }
            $writer=$null
            try {
                $writer=$entry.Open()
                if ($record.ContainsKey('size')) {
                    $remaining=[long]$record.size
                    $buffer=New-Object byte[] 65536
                    while ($remaining -gt 0) {
                        $count=[int][math]::Min($remaining,[long]$buffer.Length)
                        $writer.Write($buffer,0,$count)
                        $remaining -= $count
                    }
                } elseif ($record.ContainsKey('payload')) {
                    $bytes=[Text.Encoding]::UTF8.GetBytes([string]$record.payload)
                    $writer.Write($bytes,0,$bytes.Length)
                }
            } finally {
                if ($null -ne $writer) { $writer.Dispose() }
            }
        }
    } finally {
        if ($null -ne $zip) { $zip.Dispose() }
        if ($null -ne $file) { $file.Dispose() }
    }
    return $path
}
function Require-N65Blocked {
    param([string]$Label,[string]$Path,[string]$Kind='ps2exe')
    $rejected=$false
    try {
        $null=Assert-N65SafeCompilerArchive -Kind $Kind -PackagePath $Path
    } catch {
        $rejected=$true
        if ($_.Exception.Message -cne 'N65 compiler archive entry safety blocked.') {
            throw ('N65 produced an unsafe/unexpected rejection: '+$Label)
        }
    }
    if (-not $rejected) { throw ('N65 accepted invalid ZIP: '+$Label) }
}
try {
    $good=New-N65Zip -Entries @(
        @{name='ps2exe.psd1';payload='@{ ModuleVersion = "1.0.18" }'},
        @{name='ps2exe.psm1';payload='function Invoke-PS2Exe { }'},
        @{name='assets/';payload=''},
        @{name='assets/notice.txt';payload='independent test fixture only'}
    )
    if ((Assert-N65SafeCompilerArchive -Kind ps2exe -PackagePath $good) -ne $true -or
        (Assert-N65SafeCompilerArchive -Kind wix -PackagePath $good) -ne $true) {
        throw 'N65 rejected harmless synthetic ZIP.'
    }
    $badCases=@(
        @{ label='parent path'; entries=@(@{name='../escape.ps1';payload='x'}) },
        @{ label='nested parent path'; entries=@(@{name='tools/../escape.ps1';payload='x'}) },
        @{ label='absolute Unix'; entries=@(@{name='/windows/path.ps1';payload='x'}) },
        @{ label='Windows drive colon'; entries=@(@{name='C:/folder/tool.ps1';payload='x'}) },
        @{ label='Windows slash separator'; entries=@(@{name='tools\evil.ps1';payload='x'}) },
        @{ label='NTFS stream'; entries=@(@{name='tool.ps1:evil';payload='x'}) },
        @{ label='empty segment'; entries=@(@{name='tools//evil.ps1';payload='x'}) },
        @{ label='dot path segment'; entries=@(@{name='./tool.ps1';payload='x'}) },
        @{ label='Windows reserved device'; entries=@(@{name='AUX.txt';payload='x'}) },
        @{ label='trailing Windows dot'; entries=@(@{name='tool.';payload='x'}) },
        @{ label='trailing Windows space'; entries=@(@{name='tool ';payload='x'}) },
        @{ label='Windows wildcard'; entries=@(@{name='to*ol.ps1';payload='x'}) },
        @{ label='Unix symlink attribute'; entries=@(@{name='link.ps1';payload='x';external=-1610612736}) },
        @{ label='Windows reparse attribute'; entries=@(@{name='reparse.ps1';payload='x';external=1024}) },
        @{ label='casefold duplicate'; entries=@(
            @{name='tools/item.ps1';payload='x'},
            @{name='TOOLS/ITEM.ps1';payload='y'}) },
        @{ label='duplicate file and dir'; entries=@(
            @{name='tools';payload='x'},
            @{name='tools/';payload=''}) }
    )
    foreach($case in $badCases) {
        $zipPath=New-N65Zip -Entries $case.entries
        Require-N65Blocked -Label $case.label -Path $zipPath
    }
    $expanded=New-N65Zip -Entries @(@{name='huge.ps1';size=33554433L})
    Require-N65Blocked -Label 'PS2EXE 32MiB+ decompression entry' -Path $expanded

    $invalid=Join-Path $work 'malformed.nupkg'
    [IO.File]::WriteAllText($invalid,'not a ZIP archive')
    Require-N65Blocked -Label 'not a ZIP archive' -Path $invalid

    $source=Get-Content -LiteralPath (Join-Path $repo 'Enterprise\agent\build\Install-ApprovedCompiler.ps1') -Raw
    $ci=Get-Content -LiteralPath (Join-Path $repo '.github\workflows\ci.yml') -Raw
    $approvedPos=$source.IndexOf('Assert-N63ApprovedCompilerPackage -Kind $Kind -PackagePath $packagePath',[StringComparison]::Ordinal)
    $entryPos=$source.IndexOf('Assert-N65SafeCompilerArchive -Kind $Kind -PackagePath $packagePath',[StringComparison]::Ordinal)
    $copyPos=$source.IndexOf('Copy-Item -LiteralPath $packagePath -Destination $zip',[StringComparison]::Ordinal)
    $hashCopyPos=$source.IndexOf('Get-FileHash -LiteralPath $zip',[StringComparison]::Ordinal)
    $extractPos=$source.IndexOf('Expand-Archive -LiteralPath $zip',[StringComparison]::Ordinal)
    $wixPos=$source.IndexOf('dotnet tool install --global wix',[StringComparison]::Ordinal)
    if ($approvedPos -lt 0 -or $entryPos -le $approvedPos -or
        $copyPos -le $entryPos -or $hashCopyPos -le $copyPos -or
        $extractPos -le $hashCopyPos -or $wixPos -le $entryPos -or
        [regex]::Matches($ci,'Test-Stage65CompilerArchiveSafety\.ps1').Count -ne 2) {
        throw 'N65 archive safety check must follow N63 SHA and precede all package use on both Windows PowerShell variants.'
    }
    Write-Host 'N65 PASS: approved-archive ZIP preflight, traversal/alias/link/collision/decompression and protected install ordering.'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
