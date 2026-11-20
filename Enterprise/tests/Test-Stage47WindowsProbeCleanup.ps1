#Requires -Version 5.1
# Phase N47: local Windows filesystem fault injection only. No curl, DNS,
# HTTP, valid live consent or customer environment access.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N47 tests require actual Windows.' }

$moduleFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\PrivateWindowsProbeWorkspace.psm1'))
$probeFile = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\Test-WindowsPinnedPublicHttps.ps1'))
$moduleText = [IO.File]::ReadAllText($moduleFile)
$probeText = [IO.File]::ReadAllText($probeFile)

foreach ($unsafe in @('GetHostAddresses','Invoke-WebRequest','Invoke-RestMethod','TcpClient','curl.exe')) {
    if ($moduleText.IndexOf($unsafe,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'N47 cleanup helper may not perform any network activity.'
    }
}
foreach ($forbidden in @(
    'Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue',
    'Remove-Item -LiteralPath $directory -Force -Recurse -ErrorAction SilentlyContinue'
)) {
    if ($probeText.IndexOf($forbidden,[StringComparison]::Ordinal) -ge 0 -or
        $moduleText.IndexOf($forbidden,[StringComparison]::Ordinal) -ge 0) {
        # Module N46 creation-failure cleanup is separate and may use
        # guarded recursive deletion ONLY for its newly-created directory.
        if ($probeText.IndexOf($forbidden,[StringComparison]::Ordinal) -ge 0) {
            throw 'N47 operator wrapper still silently deletes response files.'
        }
    }
}
$cleanupCall = '$null = Remove-PrivateWindowsProbeWorkspace -Workspace $workspace'
$cleanupBlocked = "$"+"phase = 'PRIVATE_WORKSPACE_CLEANUP'"
$reportBuild = '$report = [pscustomobject]@{'
if ($probeText.IndexOf($cleanupCall,[StringComparison]::Ordinal) -lt 0 -or
    $probeText.IndexOf($cleanupBlocked,[StringComparison]::Ordinal) -lt 0 -or
    $probeText.IndexOf($reportBuild,[StringComparison]::Ordinal) -lt
       $probeText.IndexOf($cleanupCall,[StringComparison]::Ordinal)) {
    throw 'N47 cleanup guard must precede report construction and set BLOCKED diagnostic.'
}
Import-Module -Name $moduleFile -Force -ErrorAction Stop

function Assert-CleanupRefused {
    param([Parameter(Mandatory=$true)][psobject]$Workspace,[string]$Reason)
    $refused = $false
    try {
        $null = Remove-PrivateWindowsProbeWorkspace -Workspace $Workspace
    } catch {
        $refused = $true
        if ($_.Exception.Message -cne 'Private Windows health workspace cleanup blocked.') {
            throw 'Cleanup error leaked a local path, identity or file detail.'
        }
    }
    if (-not $refused) { throw ('Unsafe cleanup was accepted: ' + $Reason) }
}

$created = [System.Collections.Generic.List[string]]::new()
try {
    # Happy path: cleanup proves directory and response file are both absent.
    $normal = New-PrivateWindowsProbeWorkspace
    $created.Add($normal.Directory)
    [IO.File]::WriteAllBytes($normal.ResponsePath,[Text.Encoding]::UTF8.GetBytes(
        '{"status":"ok","components":{"database":"HEALTHY"}}'))
    if ((Remove-PrivateWindowsProbeWorkspace -Workspace $normal) -ne $true -or
        (Test-Path -LiteralPath $normal.Directory)) {
        throw 'N47 successful cleanup retained a health response.'
    }
    Assert-CleanupRefused -Workspace $normal -Reason 'replay of an already-closed workspace'

    # Untrusted caller cannot ask the helper to delete an unrelated path.
    $unknown = [pscustomobject]@{
        Directory = Join-Path ([IO.Path]::GetTempPath()) 'not-an-owned-private-folder'
        ResponsePath = Join-Path ([IO.Path]::GetTempPath()) 'not-an-owned-private-folder\response.json'
    }
    Assert-CleanupRefused -Workspace $unknown -Reason 'forged random directory'

    # Unexpected sibling/child data MUST NOT be deleted recursively.
    $extraneous = New-PrivateWindowsProbeWorkspace
    $created.Add($extraneous.Directory)
    $extra = Join-Path $extraneous.Directory 'untrusted-file.bin'
    [IO.File]::WriteAllBytes($extra,[byte[]]@(1,2,3))
    Assert-CleanupRefused -Workspace $extraneous -Reason 'unrecognized private response directory content'
    if (-not (Test-Path -LiteralPath $extra -PathType Leaf) -or
        -not (Test-Path -LiteralPath $extraneous.ResponsePath -PathType Leaf)) {
        throw 'N47 destructive cleanup touched unexpected content.'
    }
    [IO.File]::Delete($extra)
    if ((Remove-PrivateWindowsProbeWorkspace -Workspace $extraneous) -ne $true) {
        throw 'N47 failed to recover after foreign file removal.'
    }

    # Response file locked by another handle simulates AV, backup,
    # competing writer or local filesystem failure. A locked file must not
    # be silently left behind while the operator publishes PASS evidence.
    $locked = New-PrivateWindowsProbeWorkspace
    $created.Add($locked.Directory)
    $handle = [IO.File]::Open($locked.ResponsePath,[IO.FileMode]::Open,
        [IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try {
        Assert-CleanupRefused -Workspace $locked -Reason 'exclusive Windows file lock'
        if (-not (Test-Path -LiteralPath $locked.ResponsePath -PathType Leaf)) {
            throw 'N47 unexpectedly deleted an exclusively locked file.'
        }
    } finally { $handle.Dispose() }
    if ((Remove-PrivateWindowsProbeWorkspace -Workspace $locked) -ne $true -or
        (Test-Path -LiteralPath $locked.Directory)) {
        throw 'N47 cleanup could not recover from transient file lock.'
    }

    $forged = New-PrivateWindowsProbeWorkspace
    $created.Add($forged.Directory)
    $fake = [pscustomobject]@{
        Directory=$forged.Directory
        ResponsePath=(Join-Path $forged.Directory 'another-file.json')
    }
    Assert-CleanupRefused -Workspace $fake -Reason 'attempt to change registered output filename'
    if ((Remove-PrivateWindowsProbeWorkspace -Workspace $forged) -ne $true) {
        throw 'N47 refused its registered original workspace after a forged claim.'
    }

    Write-Host 'N47 PASS: guarded cleanup, Windows file-lock and unknown-child faults, no response remains or live network is attempted.'
} finally {
    # Fixture cleanup only. The production helper itself never recursively
    # deletes unknown directory contents on the normal lifecycle path.
    foreach ($path in $created) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
exit 0
