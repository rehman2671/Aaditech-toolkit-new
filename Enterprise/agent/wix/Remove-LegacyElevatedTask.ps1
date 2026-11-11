#Requires -Version 5.1
# Phase J: fail the MSI transaction unless the legacy SYSTEM task is absent.
# Runs as SYSTEM in a deferred Windows Installer custom action.
# No task is ever created; idempotent on clean installs and upgrades.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskName = 'ITToolkitAgentElevated'
$taskPath = '\'

# ScheduledTasks cmdlets avoid the nonzero schtasks.exe exit status and
# native stderr behavior on Windows PowerShell 5.1 for an absent task.
# Fail closed if the Windows ScheduledTasks API itself is unavailable.
Import-Module ScheduledTasks -ErrorAction Stop

$existing = @(Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue)
if ($existing.Count -eq 0) {
    Write-Output "$taskName is already absent"
    return
}

try {
    Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false -ErrorAction Stop
}
catch {
    throw "SECURITY_BLOCK: cannot delete legacy SYSTEM task '$taskName': $($_.Exception.Message)"
}

$remaining = @(Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue)
if ($remaining.Count -ne 0) {
    throw "SECURITY_BLOCK: legacy SYSTEM task '$taskName' survived deletion"
}
Write-Output "Removed unsafe legacy SYSTEM task $taskName"
