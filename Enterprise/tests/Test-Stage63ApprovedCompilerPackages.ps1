#Requires -Version 5.1
# N63: synthetic offline package bytes only; no source download, package
# installation, customer endpoints or publisher/reviewer secrets.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N63 requires real Windows PowerShell.' }
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'Enterprise\agent\build\ApprovedCompilerPackage.psm1') -Force -ErrorAction Stop
$installer=Join-Path $repo 'Enterprise\agent\build\Install-ApprovedCompiler.ps1'
$workflow=Join-Path $repo '.github\workflows\ci.yml'
$dir=Join-Path ([IO.Path]::GetTempPath()) ('n63-review-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($dir)
$envNames=@('GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_REPOSITORY',
            'PS2EXE_NUPKG_SHA256_APPROVED','WIX_NUPKG_SHA256_APPROVED')
$old=@{}
foreach($key in $envNames){$old[$key]=[Environment]::GetEnvironmentVariable($key)}
function Require-N63Denied {
    param([scriptblock]$Check,[string]$ExpectedMessage,[string]$Label)
    $failed=$false
    try { $null=& $Check } catch {
        $failed=$true
        if ($_.Exception.Message -cne $ExpectedMessage) {
            throw ('N63 error confidentiality mismatch: '+$Label)
        }
    }
    if (-not $failed) { throw ('N63 accepted unapproved compiler: '+$Label) }
}
try {
    $ps=Join-Path $dir 'ps2exe.1.0.18.nupkg'
    $wx=Join-Path $dir 'wix.5.0.2.nupkg'
    [IO.File]::WriteAllBytes($ps,[Text.Encoding]::ASCII.GetBytes('N63 independent synthetic PS2EXE archive'))
    [IO.File]::WriteAllBytes($wx,[Text.Encoding]::ASCII.GetBytes('N63 independent synthetic WiX archive'))
    $psSha=(Get-FileHash -LiteralPath $ps -Algorithm SHA256).Hash
    $wxSha=(Get-FileHash -LiteralPath $wx -Algorithm SHA256).Hash

    if ((Assert-N63ApprovedCompilerPackage -Kind ps2exe -PackagePath $ps -ApprovedSha256 $psSha.ToLowerInvariant()) -ne $true -or
        (Assert-N63ApprovedCompilerPackage -Kind wix -PackagePath $wx -ApprovedSha256 $wxSha) -ne $true) {
        throw 'N63 correct synthetic independent approvals were not accepted.'
    }
    foreach($entry in @(
        @{ kind='ps2exe'; file=$ps; sha=('0'*64); label='independent hash changed' },
        @{ kind='wix'; file=$wx; sha=('0'*64); label='independent wix SHA changed' },
        @{ kind='ps2exe'; file=$ps; sha=''; label='missing approved signer digest' },
        @{ kind='wix'; file=$wx; sha='5.*'; label='floating package version as fingerprint' },
        @{ kind='wix'; file=$wx; sha=($wxSha+[char]10); label='hidden extra terminator' },
        @{ kind='ps2exe'; file=$wx; sha=$wxSha; label='WiX package passed as ps2exe' },
        @{ kind='wix'; file=$ps; sha=$psSha; label='PS2EXE package passed as WiX' },
        @{ kind='ps2exe'; file=$dir; sha=$psSha; label='directory instead of package' }
    )) {
        $kindValue=[string]$entry.kind
        $packageValue=[string]$entry.file
        $digestValue=[string]$entry.sha
        Require-N63Denied -Label $entry.label -ExpectedMessage 'N63 independently approved compiler NUPKG verification blocked.' -Check {
            Assert-N63ApprovedCompilerPackage -Kind $kindValue -PackagePath $packageValue -ApprovedSha256 $digestValue
        }
    }

    # Same filename and version, changed on disk after approval -> reject.
    [IO.File]::AppendAllText($ps,' appended tampered package bytes')
    Require-N63Denied -Label 'in-place altered approved package' -ExpectedMessage 'N63 independently approved compiler NUPKG verification blocked.' -Check {
        Assert-N63ApprovedCompilerPackage -Kind ps2exe -PackagePath $ps -ApprovedSha256 $psSha
    }
    $oversized=Join-Path $dir 'ps2exe.1.0.18.nupkg'
    $file=[IO.File]::Open($oversized,[IO.FileMode]::Create,[IO.FileAccess]::Write)
    try { $file.SetLength(16777217L) } finally { $file.Dispose() }
    Require-N63Denied -Label 'PS2EXE exceeding archive size limit' -ExpectedMessage 'N63 independently approved compiler NUPKG verification blocked.' -Check {
        Assert-N63ApprovedCompilerPackage -Kind ps2exe -PackagePath $ps -ApprovedSha256 $psSha
    }

    [Environment]::SetEnvironmentVariable('GITHUB_ACTIONS','true')
    [Environment]::SetEnvironmentVariable('GITHUB_EVENT_NAME','workflow_dispatch')
    [Environment]::SetEnvironmentVariable('GITHUB_REF','refs/heads/main')
    [Environment]::SetEnvironmentVariable('GITHUB_REPOSITORY','n63-fixture/secure-test')
    if ((Assert-N63ProtectedCompilerContext -Ps2ExeApprovedSha256 $psSha -WixApprovedSha256 $wxSha) -ne $true) {
        throw 'N63 approved private manual main dispatch was blocked.'
    }
    foreach ($mode in @('push','pull_request')) {
        [Environment]::SetEnvironmentVariable('GITHUB_EVENT_NAME',$mode)
        Require-N63Denied -Label ('automatic '+$mode+' cannot install approved compiler') -ExpectedMessage 'N63 protected compiler download authorization blocked.' -Check {
            Assert-N63ProtectedCompilerContext -Ps2ExeApprovedSha256 $psSha -WixApprovedSha256 $wxSha
        }
    }
    [Environment]::SetEnvironmentVariable('GITHUB_EVENT_NAME','workflow_dispatch')
    [Environment]::SetEnvironmentVariable('GITHUB_REF','refs/heads/feature-unsafe')
    Require-N63Denied -Label 'manual non-main branch' -ExpectedMessage 'N63 protected compiler download authorization blocked.' -Check {
        Assert-N63ProtectedCompilerContext -Ps2ExeApprovedSha256 $psSha -WixApprovedSha256 $wxSha
    }
    [Environment]::SetEnvironmentVariable('GITHUB_REF','refs/heads/main')
    Require-N63Denied -Label 'only one independently approved package' -ExpectedMessage 'N63 protected compiler download authorization blocked.' -Check {
        Assert-N63ProtectedCompilerContext -Ps2ExeApprovedSha256 $psSha -WixApprovedSha256 ''
    }
    Require-N63Denied -Label 'missing both human-approved hashes' -ExpectedMessage 'N63 protected compiler download authorization blocked.' -Check {
        Assert-N63ProtectedCompilerContext -Ps2ExeApprovedSha256 '' -WixApprovedSha256 ''
    }

    # Verify the protected branch never falls back to a second unapproved
    # package resolver or re-downloads after digest attestation.
    $ci=[IO.File]::ReadAllText($workflow)
    $src=[IO.File]::ReadAllText($installer)
    foreach ($kind in @('ps2exe','wix')) {
        $marker='Install-ApprovedCompiler.ps1 -Kind '+$kind
        if ([regex]::Matches($ci,[regex]::Escape($marker)).Count -ne 1) {
            throw ('N63 protected compile gate absent: '+$kind)
        }
    }
    if ([regex]::Matches($ci,[regex]::Escape("if: github.event_name == 'push'")).Count -lt 2 -or
        [regex]::Matches($ci,[regex]::Escape("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'")).Count -lt 2 -or
        [regex]::Matches($ci,[regex]::Escape('PS2EXE_NUPKG_SHA256_APPROVED:')).Count -ne 2 -or
        [regex]::Matches($ci,[regex]::Escape('WIX_NUPKG_SHA256_APPROVED:')).Count -ne 2) {
        throw 'N63 protected installer may have diagnostic fallback or incomplete independently signed package inputs.'
    }
    $approval=$src.IndexOf('Assert-N63ProtectedCompilerContext',[StringComparison]::Ordinal)
    $download=$src.IndexOf('Invoke-WebRequest -Uri $url',[StringComparison]::Ordinal)
    $hash=$src.IndexOf('Assert-N63ApprovedCompilerPackage -Kind $Kind',[StringComparison]::Ordinal)
    $psExtract=$src.IndexOf('Expand-Archive -LiteralPath $zip',[StringComparison]::Ordinal)
    $wixInstall=$src.IndexOf('dotnet tool install --global wix --version $version --configfile $nugetConfig',[StringComparison]::Ordinal)
    if ($approval -lt 0 -or $download -le $approval -or
        $hash -le $download -or $psExtract -le $hash -or
        $wixInstall -le $hash -or
        $src.IndexOf('<clear/>',[StringComparison]::Ordinal) -lt 0 -or
        $src.IndexOf('$env:NUGET_PACKAGES=Join-Path $root',[StringComparison]::Ordinal) -lt 0 -or
        $src.IndexOf('Install-Module',[StringComparison]::Ordinal) -ge 0 -and
        $src.IndexOf('Do NOT call Install-Module',[StringComparison]::Ordinal) -lt 0) {
        throw 'N63 compiler archive hash not securely ahead of isolated package installation.'
    }
    Write-Host 'N63 PASS: independent exact NUPKG hashes, wrong version/bad size/missing reviewer pin/tampered archive and manual-only local package restore guards.'
} finally {
    foreach($key in $envNames){[Environment]::SetEnvironmentVariable($key,$old[$key])}
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
