$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../deploy/LocalWindowsDiagnostics.ps1')
function Assert-Equal($Actual,$Expected,[string]$Message) {
    if ($Actual -cne $Expected) { throw "Assertion failed: $Message" }
}
$cases=0
foreach ($status in [System.Enum]::GetValues([System.ServiceProcess.ServiceControllerStatus])) {
    $expected=$null
    if ($status.ToString() -eq 'Running') { $expected='RUNNING' }
    if ($status.ToString() -eq 'Stopped') { $expected='STOPPED' }
    Assert-Equal (Convert-LocalServiceState $status) $expected 'native service state'
    $cases++
}
foreach ($status in @('Running',1,$true,$null)) {
    Assert-Equal (Convert-LocalServiceState $status) $null 'untyped service state'
    $cases++
}
$expectedStates=@{1='DISCHARGING';3='FULL';6='CHARGING';7='CHARGING';8='CHARGING';9='CHARGING'}
foreach ($status in 0..11) {
    foreach ($charge in @(0,50,100,101,-1,'50',$true)) {
        $r=Convert-LocalBatteryArtifact @([pscustomobject]@{BatteryStatus=$status;EstimatedChargeRemaining=$charge})
        $expectedCharge=$null
        if ($charge -is [int] -and $charge -ge 0 -and $charge -le 100) { $expectedCharge=$charge }
        Assert-Equal $r.charge_percent $expectedCharge 'battery capacity bounds'
        Assert-Equal $r.charging_state $expectedStates[$status] 'battery charging status'
        Assert-Equal $r.capacity_percent $null 'no wear claim'
        $cases++
    }
}
$r=Convert-LocalBatteryArtifact @()
Assert-Equal $r.charge_percent $null 'no battery'
$r=Convert-LocalBatteryArtifact @([pscustomobject]@{BatteryStatus=1;EstimatedChargeRemaining=50},[pscustomobject]@{BatteryStatus=3;EstimatedChargeRemaining=100})
Assert-Equal $r.charge_percent $null 'multiple batteries not aggregated'
$cases+=2
foreach ($entry in @(
 @{id='a1841308-3541-4fab-bc81-f71556f20b4a';mode='POWER_SAVER'},
 @{id='381b4222-f694-41f0-9685-ff5bb260df2e';mode='BALANCED'},
 @{id='8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';mode='PERFORMANCE'},
 @{id='11111111-1111-1111-1111-111111111111';mode='OTHER'}
)) {
    $plan=[pscustomobject]@{IsActive=$true;InstanceID=('Microsoft:PowerPlan\{'+$entry.id+'}')}
    $r=Convert-LocalPowerArtifact @($plan)
    Assert-Equal $r.power_mode $entry.mode 'known native plan'
    Assert-Equal $r.sleep_policy_state $null 'no sleep policy claim'
    Assert-Equal (Convert-LocalPowerArtifact @($plan,$plan)).power_mode $null 'ambiguous active plans'
    $cases+=2
}
foreach ($value in @($true,$false,'True','False',0,1,$null)) {
    $expected=$null
    if ($value -is [bool]) { if ($value) { $expected='ENABLED' } else { $expected='DISABLED' } }
    $r=Convert-LocalFirewallArtifact @([pscustomobject]@{Name='Domain';Enabled=$value})
    Assert-Equal $r.domain_profile $expected 'strict firewall profile type'
    Assert-Equal $r.private_profile $null 'missing profile'
    Assert-Equal $r.public_profile $null 'missing profile'
    $cases++
}
$r=Convert-LocalFirewallArtifact @([pscustomobject]@{Name='Domain';Enabled=$true},[pscustomobject]@{Name='Domain';Enabled=$false})
Assert-Equal $r.domain_profile $null 'duplicate profile'
$cases++
$refused=$false
try { $null=Invoke-LocalWindowsDiagnostic -Id PRINT_STATUS } catch { $refused=$true }
Assert-Equal $refused $true 'explicit confirmation required'
$cases++
foreach ($id in @('BATTERY_HEALTH','PRINT_STATUS','BLUETOOTH_STATUS','POWER_PLAN_STATUS','FIREWALL_STATUS')) {
    $r=Invoke-LocalWindowsDiagnostic -Id $id -Confirmed
    Assert-Equal $r.production_accepted $false 'production not accepted'
    Assert-Equal $r.remote_execution_authorized $false 'remote execution not authorized'
    $json=ConvertTo-Json -InputObject $r.artifact -Compress -Depth 3
    $hash=[Security.Cryptography.SHA256]::Create()
    try { $digest=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($json))).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
    Assert-Equal $r.artifact_sha256 $digest 'artifact hash'
    $expected=0
    foreach($k in $r.artifact.Keys) { if($k -ne 'schema' -and $null -ne $r.artifact[$k]) { $expected++ } }
    Assert-Equal $r.measured_fields $expected 'measurement count'
    $cases++
}
Write-Host "PASS: $cases Windows local diagnostic cases (includes real read-only provider smoke; unknown measurements allowed)."
