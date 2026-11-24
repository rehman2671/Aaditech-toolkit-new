# Isolate actual task retirement script with mock cmdlets, never touch real
# runner scheduled tasks. Child script exit is intentionally captured.
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '..\agent\wix\Create-ElevatedTask.ps1'
$raw=Get-Content -LiteralPath $path -Raw
if ($raw -match '(?i)\bRegisterTask\s*\(|\bRegister-ScheduledTask\b') {throw 'Legacy task registration still present'}
# Execute in same scope as child script, substitute only exit statements
# so mock tests can assert both successful and failed retirement behavior.
$source=$raw -replace '(?m)^#Requires[^\r\n]*','' -replace '(?m)^(\s*)exit 0\s*$','$1return 0' -replace '(?m)^(\s*)exit 3\s*$','$1return 3'
$source=$source -replace "Write-Error 'Legacy privileged task retirement could not be verified'","Write-Output 'LEGACY_RETIREMENT_FAILED'"
$scriptBlock=[scriptblock]::Create($source)
$script:present=$true;$script:removed=$false;$script:stopped=$false;$script:failRemoval=$false
function Get-ScheduledTask {
    param([string]$TaskPath,$ErrorAction)
    if($TaskPath -cne '\'){throw 'Non-root query'}
    if($script:present){[pscustomobject]@{TaskName='ITToolkitAgentElevated';TaskPath='\';State='Running'}}
    [pscustomobject]@{TaskName='OtherTask';TaskPath='\';State='Ready'}
}
function Stop-ScheduledTask {param($InputObject,$ErrorAction)
    if($InputObject.TaskName -cne 'ITToolkitAgentElevated'){throw 'Wrong task stopped'}
    $script:stopped=$true
}
function Unregister-ScheduledTask {param($InputObject,[switch]$Confirm,$ErrorAction)
    if($InputObject.TaskName -cne 'ITToolkitAgentElevated'){throw 'Wrong task removed'}
    if($script:failRemoval){throw 'Synthetic removal failure'}
    $script:removed=$true;$script:present=$false
}
$result=@(& $scriptBlock)
if($result[-1] -ne 0 -or -not $script:removed -or -not $script:stopped -or $script:present){throw 'Legacy task not retired'}
$result=@(& $scriptBlock)
if($result[-1] -ne 0){throw 'Absent legacy task was not idempotent'}
$script:present=$true;$script:failRemoval=$true
$result=@(& $scriptBlock)
if($result[-1] -ne 3 -or -not $script:present){throw 'Removal failure accepted'}
Write-Host '[PASS] Exact root legacy task retirement succeeds idempotently and fails closed on removal error.'
