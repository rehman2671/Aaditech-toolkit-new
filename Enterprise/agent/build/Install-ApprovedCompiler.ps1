#Requires -Version 5.1
# N63 protected manual main build: download a reviewed NUPKG, verify the
# INDEPENDENT human-approved SHA256, then install exclusively from those
# exact local bytes. Never let NuGet or PowerShellGet refetch a same-version
# but different package after the approval check.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('ps2exe','wix')][string]$Kind)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=$null
$oldNugetPackages=$env:NUGET_PACKAGES
$oldNugetHttpCache=$env:NUGET_HTTP_CACHE_PATH
try {
    Import-Module -Name (Join-Path $PSScriptRoot 'BuildToolchainLock.psm1') -Force -ErrorAction Stop
    Import-Module -Name (Join-Path $PSScriptRoot 'ApprovedCompilerPackage.psm1') -Force -ErrorAction Stop
    $null=Assert-N63ProtectedCompilerContext -Ps2ExeApprovedSha256 $env:PS2EXE_NUPKG_SHA256_APPROVED -WixApprovedSha256 $env:WIX_NUPKG_SHA256_APPROVED

    $lock=Get-N62BuildToolchainLock
    $version=if ($Kind -ceq 'ps2exe') { [string]$lock.ps2exe } else { [string]$lock.wix }
    $approved=if ($Kind -ceq 'ps2exe') { $env:PS2EXE_NUPKG_SHA256_APPROVED } else { $env:WIX_NUPKG_SHA256_APPROVED }
    $url=if ($Kind -ceq 'ps2exe') {
        'https://www.powershellgallery.com/api/v2/package/ps2exe/'+$version
    } else {
        'https://api.nuget.org/v3-flatcontainer/wix/'+$version+'/wix.'+$version+'.nupkg'
    }
    if ($env:RUNNER_TEMP -eq '' -or
        -not (Test-Path -LiteralPath $env:RUNNER_TEMP -PathType Container)) {
        throw 'Protected GitHub runner temporary path unavailable.'
    }
    $root=Join-Path $env:RUNNER_TEMP ('n63-compiler-'+[guid]::NewGuid().ToString('N'))
    $null=[IO.Directory]::CreateDirectory($root)
    $packagePath=Join-Path $root ($Kind+'.'+$version+'.nupkg')

    # Only fixed HTTPS package-version endpoints; neither current version
    # nor expected digest is inferred from the bytes being downloaded.
    Invoke-WebRequest -Uri $url -OutFile $packagePath -UseBasicParsing -MaximumRedirection 3 -ErrorAction Stop
    $null=Assert-N63ApprovedCompilerPackage -Kind $Kind -PackagePath $packagePath -ApprovedSha256 $approved

    if ($Kind -ceq 'ps2exe') {
        # PowerShell Gallery supports manually extracting .nupkg content.
        # Copy the *independently checked* archive to .zip for Expand-Archive,
        # then install only those vetted source files into the user module
        # directory. Do NOT call Install-Module in the protected path.
        $zip=Join-Path $root 'ps2exe.zip'
        Copy-Item -LiteralPath $packagePath -Destination $zip -Force -ErrorAction Stop
        $extract=Join-Path $root 'verified-extraction'
        Expand-Archive -LiteralPath $zip -DestinationPath $extract -ErrorAction Stop
        $manifests=@(Get-ChildItem -LiteralPath $extract -Recurse -File -Filter 'ps2exe.psd1' -ErrorAction Stop)
        if ($manifests.Count -ne 1 -or
            -not (Test-Path -LiteralPath (Join-Path $manifests[0].Directory.FullName 'ps2exe.psm1') -PathType Leaf)) {
            throw 'Approved PSGallery package does not contain the expected PS2EXE module.'
        }
        # The module must resolve via Windows PowerShell 5.1 (not PS7
        # Powershell\Modules) when the subsequent ps2exe compiler runs.
        $documents=[Environment]::GetFolderPath('MyDocuments')
        if ([string]::IsNullOrWhiteSpace($documents)) { throw 'User PowerShell module directory unavailable.' }
        $destination=Join-Path $documents ('WindowsPowerShell\Modules\ps2exe\'+$version)
        $null=[IO.Directory]::CreateDirectory($destination)
        foreach ($entry in @(Get-ChildItem -LiteralPath $manifests[0].Directory.FullName -Force -ErrorAction Stop)) {
            Copy-Item -LiteralPath $entry.FullName -Destination $destination -Force -Recurse -ErrorAction Stop
        }
        $null=Assert-N62InstalledPs2Exe
    } else {
        # NuGet source isolation is mandatory. --add-source alone is NOT
        # secure: an upstream feed may win package resolution races.
        $feed=Join-Path $root 'verified-feed'
        $null=[IO.Directory]::CreateDirectory($feed)
        Copy-Item -LiteralPath $packagePath -Destination (Join-Path $feed ('wix.'+$version+'.nupkg')) -ErrorAction Stop
        $null=Assert-N63ApprovedCompilerPackage -Kind wix -PackagePath (Join-Path $feed ('wix.'+$version+'.nupkg')) -ApprovedSha256 $approved
        $nugetConfig=Join-Path $root 'NuGet.Config'
        $feedXml=[System.Security.SecurityElement]::Escape($feed)
        $config='<?xml version="1.0" encoding="utf-8"?><configuration><packageSources><clear/><add key="reviewed-local-only" value="'+$feedXml+'"/></packageSources></configuration>'
        [IO.File]::WriteAllText($nugetConfig,$config,[Text.UTF8Encoding]::new($false))
        # Prevent an already cached same-version upstream NUPKG from
        # bypassing the only-source-is-reviewed-local constraint.
        $env:NUGET_PACKAGES=Join-Path $root 'isolated-nuget-packages'
        $env:NUGET_HTTP_CACHE_PATH=Join-Path $root 'isolated-nuget-http-cache'
        & dotnet tool install --global wix --version $version --configfile $nugetConfig
        if ($LASTEXITCODE -ne 0) { throw 'Offline approved WiX tool restore failed.' }
        $env:Path=(Join-Path $env:USERPROFILE '.dotnet\tools')+';'+$env:Path
        $null=Assert-N62InstalledWix
    }
    Write-Host 'N63 independently approved compiler NUPKG installed from verified local package only.'
} catch {
    throw 'N63 protected compiler archive download or offline installation blocked.'
} finally {
    $env:NUGET_PACKAGES=$oldNugetPackages
    $env:NUGET_HTTP_CACHE_PATH=$oldNugetHttpCache
    if ($null -ne $root -and (Test-Path -LiteralPath $root)) {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}
