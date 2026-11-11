#Requires -Version 5.1
# Phase J: fail the MSI transaction unless the unsafe SYSTEM helper is absent.
# Runs as an elevated MSI custom action, before starting ITToolkitAgent.
# No task is ever created. This is idempotent across clean install/upgrade.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$task = 'ITToolkitAgentElevated'

# Task Scheduler returns nonzero when the task is already absent.
# An absent task is the desired state on a fresh Windows install.
& schtasks.exe /Query /TN $task 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    $global:LASTEXITCODE = 0
    Write-Output "$task already absent"
    exit 0
}

# A legacy SYSTEM task is unsafe even when the normal agent is disabled.
& schtasks.exe /Delete /TN $task /F 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "SECURITY_BLOCK: cannot delete legacy SYSTEM task '$task'; MSI installation must fail."
}

& schtasks.exe /Query /TN $task 2>$null | Out-Null
$stillThere = ($LASTEXITCODE -eq 0)
$global:LASTEXITCODE = 0
if ($stillThere) {
    throw "SECURITY_BLOCK: legacy SYSTEM task '$task' survived deletion."
}
Write-Output "Removed unsafe legacy SYSTEM task $task"
