# Local Windows read-only reference; not a remote agent command.
[CmdletBinding()]
param(
    [ValidateSet('BATTERY_HEALTH','PRINT_STATUS','BLUETOOTH_STATUS','POWER_PLAN_STATUS','FIREWALL_STATUS','UPDATE_STATUS','BOOT_TIMING')]
    [string]$DiagnosticId,
    [switch]$ConfirmLocalReadOnly
)
Set-StrictMode -Version Latest
# Windows PowerShell 5.1 does not eagerly load this framework assembly.
if ($PSVersionTable.PSEdition -eq 'Desktop') { Add-Type -AssemblyName System.ServiceProcess -ErrorAction Stop }

function Convert-LocalServiceState {
    param($Status)
    if ($Status -is [System.ServiceProcess.ServiceControllerStatus]) {
        if ($Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running) { return 'RUNNING' }
        if ($Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) { return 'STOPPED' }
    }
    return $null
}
function Get-LocalServiceState {
    param([ValidateSet('Spooler','bthserv')][string]$Name)
    try {
        $services = @(Microsoft.PowerShell.Management\Get-Service -Name $Name -ErrorAction Stop)
        if ($services.Count -eq 1 -and $services[0].Name -eq $Name) { return Convert-LocalServiceState $services[0].Status }
    } catch { return $null }
    return $null
}
function Convert-LocalBatteryArtifact {
    param([object[]]$Batteries)
    $doc = [ordered]@{schema='aaditech-battery-diagnostic-v1';charge_percent=$null;charging_state=$null;capacity_percent=$null}
    if ($Batteries.Count -ne 1) { return $doc }
    $b = $Batteries[0]
    $charge = $b.EstimatedChargeRemaining
    if (($charge -is [uint16] -or $charge -is [int] -or $charge -is [uint32]) -and $charge -ge 0 -and $charge -le 100) {
        $doc.charge_percent = [int]$charge
    }
    $status = $b.BatteryStatus
    if ($status -is [uint16] -or $status -is [int] -or $status -is [uint32]) {
        switch ($status) {
            1 { $doc.charging_state='DISCHARGING' }
            3 { $doc.charging_state='FULL' }
            6 { $doc.charging_state='CHARGING' }
            7 { $doc.charging_state='CHARGING' }
            8 { $doc.charging_state='CHARGING' }
            9 { $doc.charging_state='CHARGING' }
        }
    }
    # Win32_Battery alone is not reliable wear/design capacity evidence.
    return $doc
}
function Convert-LocalPowerArtifact {
    param([object[]]$Plans)
    $doc = [ordered]@{schema='aaditech-power-diagnostic-v1';power_mode=$null;sleep_policy_state=$null}
    $active = @($Plans | Where-Object { $_.IsActive -is [bool] -and $_.IsActive })
    if ($active.Count -ne 1) { return $doc }
    $instance = $active[0].InstanceID
    $prefix='Microsoft:PowerPlan\{'
    if ($instance -isnot [string] -or -not $instance.StartsWith($prefix,[StringComparison]::Ordinal) -or -not $instance.EndsWith('}') -or $instance.Length -ne ($prefix.Length+37)) { return $doc }
    $id = [guid]::Empty
    if (-not [guid]::TryParseExact($instance.Substring($prefix.Length,36),'D',[ref]$id)) { return $doc }
    switch ($id.ToString('D')) {
        'a1841308-3541-4fab-bc81-f71556f20b4a' { $doc.power_mode='POWER_SAVER' }
        '381b4222-f694-41f0-9685-ff5bb260df2e' { $doc.power_mode='BALANCED' }
        '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' { $doc.power_mode='PERFORMANCE' }
        default { $doc.power_mode='OTHER' }
    }
    return $doc
}
function Convert-LocalFirewallArtifact {
    param([object[]]$Profiles)
    $doc = [ordered]@{schema='aaditech-firewall-diagnostic-v1';domain_profile=$null;private_profile=$null;public_profile=$null}
    foreach ($name in @('Domain','Private','Public')) {
        $matchesFound = @($Profiles | Where-Object { $_.Name -ceq $name })
        if ($matchesFound.Count -ne 1) { continue }
        $value = $matchesFound[0].Enabled
        # NetSecurity exposes GpoBoolean (True/False/NotConfigured); avoid
        # truthiness, strings and numerical coercion.
        if ($value -is [bool] -or ($null -ne $value -and $value.GetType().IsEnum -and $value.GetType().Name -eq 'GpoBoolean')) {
            if ($value.ToString() -ceq 'True') { $doc[$name.ToLowerInvariant()+'_profile']='ENABLED' }
            elseif ($value.ToString() -ceq 'False') { $doc[$name.ToLowerInvariant()+'_profile']='DISABLED' }
        }
    }
    return $doc
}
function Convert-LocalUpdateArtifact {
    param($RebootMarker)
    $doc=[ordered]@{schema='aaditech-update-diagnostic-v1';update_state=$null;restart_state=$null}
    # Presence is positive evidence only. Absence is not proof of no pending reboot.
    if ($RebootMarker -is [bool] -and $RebootMarker) { $doc.restart_state='REQUIRED' }
    return $doc
}
function Get-LocalUpdateArtifact {
    $found=$null
    $base=$null
    $key=$null
    try {
        $view=[Microsoft.Win32.RegistryView]::Registry32
        if ([Environment]::Is64BitOperatingSystem) { $view=[Microsoft.Win32.RegistryView]::Registry64 }
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
        $key=$base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired',$false)
        if ($null -ne $key) { $found=$true }
    } catch { $found=$null }
    finally {
        if ($null -ne $key) { $key.Dispose() }
        if ($null -ne $base) { $base.Dispose() }
    }
    return Convert-LocalUpdateArtifact $found
}
function Convert-LocalBootArtifact {
    param($EventXml)
    $doc=[ordered]@{schema='aaditech-boot-diagnostic-v1';boot_duration_ms=$null;startup_duration_ms=$null}
    if ($EventXml -isnot [string] -or $EventXml.Length -lt 1 -or $EventXml.Length -gt 32768) { return $doc }
    $reader=$null
    $source=$null
    try {
        $settings=New-Object System.Xml.XmlReaderSettings
        $settings.DtdProcessing=[System.Xml.DtdProcessing]::Prohibit
        $settings.XmlResolver=$null
        $settings.MaxCharactersInDocument=32768
        $source=New-Object System.IO.StringReader($EventXml)
        $reader=[System.Xml.XmlReader]::Create($source,$settings)
        $xml=New-Object System.Xml.XmlDocument
        $xml.XmlResolver=$null
        $xml.Load($reader)
        $ns=New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
        $ns.AddNamespace('e','http://schemas.microsoft.com/win/2004/08/events/event')
        $provider=$xml.SelectNodes('/e:Event/e:System/e:Provider',$ns)
        $eventId=$xml.SelectNodes('/e:Event/e:System/e:EventID',$ns)
        if ($provider.Count -ne 1 -or $eventId.Count -ne 1 -or $provider[0].GetAttribute('Name') -cne 'Microsoft-Windows-Diagnostics-Performance' -or $eventId[0].InnerText -cne '100') { return $doc }
        $times=$xml.SelectNodes('/e:Event/e:EventData/e:Data[@Name="BootTime"]',$ns)
        if ($times.Count -ne 1 -or $times[0].ChildNodes.Count -ne 1 -or $times[0].FirstChild.NodeType -ne [System.Xml.XmlNodeType]::Text) { return $doc }
        $raw=$times[0].InnerText
        if ($raw -cnotmatch '\A(0|[1-9][0-9]{0,7})\z') { return $doc }
        $value=0
        if ([int]::TryParse($raw,[ref]$value) -and $value -le 86400000) { $doc.boot_duration_ms=$value }
    } catch { return $doc }
    finally {
        if ($null -ne $reader) { $reader.Dispose() }
        if ($null -ne $source) { $source.Dispose() }
    }
    return $doc
}
function Get-LocalBootArtifact {
    $raw=$null
    try {
        # Only a recent recorded boot event, never inferred current boot speed.
        $events=@(Microsoft.PowerShell.Diagnostics\Get-WinEvent -FilterHashtable @{
            LogName='Microsoft-Windows-Diagnostics-Performance/Operational';
            ProviderName='Microsoft-Windows-Diagnostics-Performance';Id=100;StartTime=(Get-Date).AddDays(-7)
        } -MaxEvents 1 -ErrorAction Stop)
        if ($events.Count -eq 1 -and $events[0].TimeCreated -le (Get-Date)) { $raw=$events[0].ToXml() }
    } catch { $raw=$null }
    return Convert-LocalBootArtifact $raw
}
function Invoke-LocalWindowsDiagnostic {
    param([ValidateSet('BATTERY_HEALTH','PRINT_STATUS','BLUETOOTH_STATUS','POWER_PLAN_STATUS','FIREWALL_STATUS','UPDATE_STATUS','BOOT_TIMING')][string]$Id,[switch]$Confirmed)
    if (-not $Confirmed -or [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'EXPLICIT_LOCAL_WINDOWS_POLICY_REQUIRED' }
    switch ($Id) {
        'BATTERY_HEALTH' {
            $rows = @()
            try { $rows = @(CimCmdlets\Get-CimInstance -ClassName Win32_Battery -Property EstimatedChargeRemaining,BatteryStatus -OperationTimeoutSec 10 -ErrorAction Stop) } catch { $rows=@() }
            $doc = Convert-LocalBatteryArtifact $rows
        }
        'PRINT_STATUS' { $doc=[ordered]@{schema='aaditech-print-diagnostic-v1';queue_state=$null;service_state=(Get-LocalServiceState 'Spooler')} }
        'BLUETOOTH_STATUS' { $doc=[ordered]@{schema='aaditech-bluetooth-diagnostic-v1';radio_state=$null;service_state=(Get-LocalServiceState 'bthserv')} }
        'POWER_PLAN_STATUS' {
            $rows=@()
            try { $rows=@(CimCmdlets\Get-CimInstance -Namespace root/cimv2/power -ClassName Win32_PowerPlan -Property IsActive,InstanceID -OperationTimeoutSec 10 -ErrorAction Stop) } catch { $rows=@() }
            $doc=Convert-LocalPowerArtifact $rows
        }
        'FIREWALL_STATUS' {
            $rows=@()
            try { $rows=@(NetSecurity\Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop) } catch { $rows=@() }
            $doc=Convert-LocalFirewallArtifact $rows
        }
        'UPDATE_STATUS' { $doc=Get-LocalUpdateArtifact }
        'BOOT_TIMING' { $doc=Get-LocalBootArtifact }
        default { throw 'UNKNOWN_LOCAL_DIAGNOSTIC' }
    }
    $json=ConvertTo-Json -InputObject $doc -Compress -Depth 3
    $bytes=[Text.Encoding]::UTF8.GetBytes($json)
    if ($bytes.Length -gt 512) { throw 'LOCAL_ARTIFACT_LIMIT' }
    $hash=[Security.Cryptography.SHA256]::Create()
    try { $digest=[BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
    $measured=0
    foreach($key in $doc.Keys) { if($key -ne 'schema' -and $null -ne $doc[$key]) { $measured++ } }
    return [ordered]@{schema_version=1;artifact=$doc;artifact_sha256=$digest;measured_fields=$measured;
        collection_scope='LOCAL_OPERATOR_REFERENCE';measurement_truth_verified=$false;remote_execution_authorized=$false;production_accepted=$false}
}
if ($MyInvocation.InvocationName -ne '.') {
    try {
        if (-not $DiagnosticId) { throw 'UNKNOWN_LOCAL_DIAGNOSTIC' }
        $result=Invoke-LocalWindowsDiagnostic -Id $DiagnosticId -Confirmed:$ConfirmLocalReadOnly
        ConvertTo-Json -InputObject $result -Compress -Depth 5
    } catch {
        [Console]::Error.WriteLine('Local Windows diagnostic refused. Use a supported diagnostic and explicit read-only confirmation.')
        exit 1
    }
}
