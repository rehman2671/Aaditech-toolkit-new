#Requires -Version 5.1
# N54 offline supply-chain regression: CI-only synthetic bytes, never the
# actual SQLite package and NEVER a customer/production approval.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N54 requires Windows.' }

$modulePath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\agent\wix\SqliteBundleApproval.psm1'))
$buildPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\agent\wix\build-msi.ps1'))
$build=[IO.File]::ReadAllText($buildPath)
$module=[IO.File]::ReadAllText($modulePath)
foreach ($unsafe in @('Invoke-WebRequest','Invoke-RestMethod','Start-Process','DownloadFile','System.Net.Dns')) {
    if ($module.IndexOf($unsafe,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'N54 digest verifier must remain entirely offline.'
    }
}
# Static fail-closed sequencing: only protected release secret hashes
# may authorize shipping SQLite; reject *before* any archive decompression.
$ordered=@(
    'if ($releasePackage -and',
    'Invoke-WebRequest -Uri $sqliteUrl',
    'Assert-N54ApprovedSqliteFile -Path $sqliteZip -Kind Archive',
    'Expand-Archive -LiteralPath $sqliteZip',
    'Assert-N54ApprovedSqliteFile -Path $sqliteExe.FullName -Kind Executable',
    'Copy-Item -LiteralPath $sqliteExe.FullName -Destination $stageSqlite',
    'Assert-N54ApprovedSqliteFile -Path $stageSqlite -Kind Executable'
)
$last=-1
foreach ($marker in $ordered) {
    $at=$build.IndexOf($marker,[StringComparison]::Ordinal)
    if ($at -le $last) { throw ('N54 packaging pin check order incorrect: '+$marker) }
    $last=$at
}
foreach ($required in @(
    'RELEASE_SIGNING_ENABLED',
    'SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED',
    'SQLITE3_EXE_SHA256_APPROVED',
    'N54 SQLite independently approved ZIP and EXE pins required before download.',
    'diagnostic MSI only',
    'SqliteBundleApproval.psm1'
)) {
    if ($build.IndexOf($required,[StringComparison]::Ordinal) -lt 0) {
        throw ('N54 required fail-closed packaging gate missing: '+$required)
    }
}
Import-Module -Name $modulePath -Force -ErrorAction Stop

function Assert-N54Reject {
    param([scriptblock]$Action,[string]$Case)
    $refused=$false
    try { $null = & $Action } catch {
        $refused=$true
        if ($_.Exception.Message -cne 'N54 SQLite signed-release payload approval blocked.') {
            throw 'N54 error disclosed untrusted path, digest or artifact bytes.'
        }
    }
    if (-not $refused) { throw ('N54 wrongly accepted '+$Case) }
}

$dir=Join-Path ([IO.Path]::GetTempPath()) ('n54-local-only-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($dir)
$hash=$null
try {
    $zip=Join-Path $dir 'synthetic.zip'
    $exe=Join-Path $dir 'synthetic.exe'
    [IO.File]::WriteAllBytes($zip,[Text.Encoding]::ASCII.GetBytes('N54 ONLY - synthetic archive payload'))
    [IO.File]::WriteAllBytes($exe,[Text.Encoding]::ASCII.GetBytes('N54 ONLY - synthetic sqlite binary payload'))
    $hash=[Security.Cryptography.SHA256]::Create()
    $zipHash=[BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($zip))).Replace('-','')
    $exeHash=[BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($exe))).Replace('-','')
    if ((Assert-N54ApprovedSqliteFile -Path $zip -Kind Archive -ApprovedSha256 $zipHash) -ne $true -or
        (Assert-N54ApprovedSqliteFile -Path $exe -Kind Executable -ApprovedSha256 $exeHash.ToLowerInvariant()) -ne $true) {
        throw 'N54 valid synthetic byte digest was refused.'
    }
    foreach ($pin in @('', ('x'*64), ('A'*63), ('0'*64), " $exeHash", "0x$exeHash")) {
        $bad=[string]$pin
        Assert-N54Reject -Case 'unapproved or malformed digest' -Action {
            Assert-N54ApprovedSqliteFile -Path $exe -Kind Executable -ApprovedSha256 $bad
        }
    }
    $changed=[Text.Encoding]::ASCII.GetBytes('N54 synthetic payload modified after independent pin')
    [IO.File]::WriteAllBytes($exe,$changed)
    Assert-N54Reject -Case 'changed executable after approval' -Action {
        Assert-N54ApprovedSqliteFile -Path $exe -Kind Executable -ApprovedSha256 $exeHash
    }
    Assert-N54Reject -Case 'digest does not cross archive/executable boundary' -Action {
        Assert-N54ApprovedSqliteFile -Path $zip -Kind Archive -ApprovedSha256 $exeHash
    }
    Assert-N54Reject -Case 'refuse UNC before DNS' -Action {
        Assert-N54ApprovedSqliteFile -Path '\\synthetic.invalid\share\sqlite.exe' -Kind Executable -ApprovedSha256 $exeHash
    }
    Assert-N54Reject -Case 'refuse directory' -Action {
        Assert-N54ApprovedSqliteFile -Path $dir -Kind Executable -ApprovedSha256 $exeHash
    }
    [IO.File]::WriteAllBytes($exe,[byte[]]::new(0))
    Assert-N54Reject -Case 'refuse zero-byte executable' -Action {
        Assert-N54ApprovedSqliteFile -Path $exe -Kind Executable -ApprovedSha256 $exeHash
    }
    $oversized=Join-Path $dir 'oversized.exe'
    $stream=[IO.File]::Open($oversized,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.SetLength(33554433) } finally { $stream.Dispose() }
    Assert-N54Reject -Case 'refuse oversized executable without hashing' -Action {
        Assert-N54ApprovedSqliteFile -Path $oversized -Kind Executable -ApprovedSha256 $exeHash
    }
    Write-Host 'N54 PASS: release-only independent ZIP/EXE pinned digests, mutation, invalid hashes, UNC, directory and size faults (offline).'
} finally {
    if ($null -ne $hash) { $hash.Dispose() }
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
