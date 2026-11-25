# Native PowerShell 5.1 / 7 local fixture. No deployment, services changed,
# network requests or secret contents read by the inspected script.
$ErrorActionPreference='Stop'
$script=Join-Path $PSScriptRoot '..\deploy\Inspect-LanWindowsHost.ps1'
$root=Join-Path $env:RUNNER_TEMP ('lan-host-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $secret='SYNTHETIC-HOST-CREDENTIAL-MUST-NOT-LEAK'
    $marker=Join-Path $root 'credential.marker'
    [IO.File]::WriteAllText($marker,$secret)
    $argsMap=@{
        TargetDirectory=$root; DatabaseMarker=(Join-Path $root 'absent')
        CredentialMarker=$marker; ServiceName=('itk-test-'+[guid]::NewGuid().ToString('N'))
        Ports=@(443,3306); MinCpu=1; MinMemoryBytes=1; MinFreeBytes=1
    }
    $raw=& $script @argsMap
    $result=$raw | ConvertFrom-Json
    if ($result.installation_authorized -ne $false -or $result.resource_absence_verified -ne $false -or
        $result.runtime_compatibility_verified -ne $false -or $result.decision -cne 'EXTERNAL_APPROVAL_REQUIRED' -or
        $result.markers.credentials -cne 'PRESENT' -or $result.markers.database -cne 'NOT_OBSERVED' -or
        $result.markers.service -cne 'UNKNOWN' -or @($result.ports).Count -ne 2) {throw 'Unsafe or missing host evidence'}
    if ($raw.Contains($secret) -or $raw.Contains($argsMap.ServiceName) -or $raw.Contains('credential.marker')) {throw 'Report leaked private data'}
    if ([IO.File]::ReadAllText($marker) -cne $secret) {throw 'Credential marker changed'}
    $argsMap.MinFreeBytes=[long]::MaxValue
    $low=(& $script @argsMap | ConvertFrom-Json)
    if (($low.checks | Where-Object id -eq 'drive_root_space').state -cne 'INSUFFICIENT') {throw 'Impossible disk threshold accepted'}
    $argsMap.Ports=@(443,443)
    $rejected=$false
    try { $null=& $script @argsMap } catch { $rejected=$true }
    if (-not $rejected) {throw 'Duplicate port accepted'}
    $argsMap.Ports=@(443)
    $argsMap.DatabaseMarker='\\invalid.example\share\db'
    $rejected=$false
    try { $null=& $script @argsMap } catch { $rejected=$true }
    if (-not $rejected) {throw 'UNC path accepted'}
    Write-Host '[PASS] Windows read-only host observations, redaction and local-only input validation.'
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
