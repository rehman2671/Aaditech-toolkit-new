#Requires -Version 5.1
# Historical filename preserved for MSI component continuity. This script
# ONLY retires the exact legacy root task; never registers or executes it.
[CmdletBinding()]
param([string]$AgentExe)
$ErrorActionPreference='Stop'
$name='ITToolkitAgentElevated'
try {
    # Enumerate the root folder, including disabled tasks; querying the
    # exact name may throw on absence, so require successful enumeration.
    $matches=@(Get-ScheduledTask -TaskPath '\' -ErrorAction Stop |
        Where-Object {$_.TaskName -ieq $name -and $_.TaskPath -eq '\'})
    if ($matches.Count -gt 1) {throw 'Ambiguous legacy task'}
    if ($matches.Count -eq 1) {
        if ($matches[0].State -eq 'Running') {
            Stop-ScheduledTask -InputObject $matches[0] -ErrorAction Stop
        }
        Unregister-ScheduledTask -InputObject $matches[0] -Confirm:$false -ErrorAction Stop
    }
    $remaining=@(Get-ScheduledTask -TaskPath '\' -ErrorAction Stop |
        Where-Object {$_.TaskName -ieq $name -and $_.TaskPath -eq '\'})
    if ($remaining.Count -ne 0) {throw 'Legacy task still present'}
    Write-Output 'LEGACY_ELEVATED_TASK_ABSENT'
    exit 0
} catch {
    Write-Error 'Legacy privileged task retirement could not be verified'
    exit 3
}
