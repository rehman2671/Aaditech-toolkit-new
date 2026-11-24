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
foreach ($marker in @($true,$false,1,0,'True','False',$null)) {
    $r=Convert-LocalUpdateArtifact $marker
    $expected=$null
    if ($marker -is [bool] -and $marker) { $expected='REQUIRED' }
    Assert-Equal $r.restart_state $expected 'positive reboot marker only'
    Assert-Equal $r.update_state $null 'no inferred update outcome'
    $cases++
}
function New-BootFixture([string]$Value,[string]$Provider='Microsoft-Windows-Diagnostics-Performance',[string]$EventId='100') {
    return ('<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event"><System><Provider Name="'+$Provider+'"/><EventID>'+$EventId+'</EventID></System><EventData><Data Name="BootTime">'+$Value+'</Data></EventData></Event>')
}
foreach ($value in @('0','1','100','12345','86400000','86400001','99999999','-1','01','1.0','1e3','', ' 100','100 ','true','&amp;')) {
    $expected=$null
    if ($value -in @('0','1','100','12345','86400000')) { $expected=[int]$value }
    $r=Convert-LocalBootArtifact (New-BootFixture $value)
    Assert-Equal $r.boot_duration_ms $expected 'bounded event duration'
    Assert-Equal $r.startup_duration_ms $null 'no inferred startup duration'
    $cases++
}
foreach($provider in @('Microsoft-Windows-Diagnostics-Performance','wrong','microsoft-windows-diagnostics-performance')) {
    foreach($eventId in @('100','101','0100','0','')) {
        $expected=$null
        if ($provider -ceq 'Microsoft-Windows-Diagnostics-Performance' -and $eventId -ceq '100') { $expected=100 }
        Assert-Equal (Convert-LocalBootArtifact (New-BootFixture '100' $provider $eventId)).boot_duration_ms $expected 'exact event authority'
        $cases++
    }
}
$valid=New-BootFixture '100'
foreach($bad in @($null,42,'',('<!DOCTYPE Event [<!ENTITY x "100">]>'+$valid),($valid.Replace('</EventData>','<Data Name="BootTime">100</Data></EventData>')),($valid.Replace('>100</Data>','><Nested>100</Nested></Data>')),('x'*32769))) {
    Assert-Equal (Convert-LocalBootArtifact $bad).boot_duration_ms $null 'invalid or ambiguous XML'
    $cases++
}
foreach ($id in @('BATTERY_HEALTH','PRINT_STATUS','BLUETOOTH_STATUS','POWER_PLAN_STATUS','FIREWALL_STATUS','UPDATE_STATUS','BOOT_TIMING')) {
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
