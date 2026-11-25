# ==============================================================================
# Aaditech Enterprise Standalone Endpoint Agent
# Compatible with Windows 10, 11, Server 2016+
# Designed for Hostinger Shared Cloud & Self-Hosted Node.js/MySQL Platforms
# ==============================================================================

[CmdletBinding()]
param(
    [string]$ConfigPath = "$PSScriptRoot\agent.json",
    [switch]$Once,
    [switch]$VerboseOutput
)

$ErrorActionPreference = "Continue"

# 1. Load Configuration
if (-not (Test-Path $ConfigPath)) {
    $ConfigPath = "C:\ProgramData\AaditechAgent\agent.json"
}

if (-not (Test-Path $ConfigPath)) {
    Write-Host "[ERROR] Configuration file not found at: $ConfigPath" -ForegroundColor Red
    exit 1
}

try {
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
} catch {
    Write-Host "[ERROR] Failed to parse JSON config: $_" -ForegroundColor Red
    exit 1
}

$Endpoint = $config.endpoint
$Token    = if ($config.device_token) { $config.device_token } else { $config.token }
$Interval = if ($config.interval_seconds) { [int]$config.interval_seconds } else { 30 }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Aaditech Enterprise Endpoint Agent" -ForegroundColor Cyan
Write-Host "  Reporting Server: $Endpoint" -ForegroundColor Green
Write-Host "  Interval: ${Interval}s" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan

# No remote command signature validator lives in this legacy telemetry
# collector. Only the separately installed Agent-Collect.ps1 performs
# domain-separated, tenant/device/host/time-bound command verification.

function Get-HardwareDetails {
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1

    $totalRam = if ($cs -and $null -ne $cs.TotalPhysicalMemory -and [double]$cs.TotalPhysicalMemory -gt 0) { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) } else { $null }
    
    return @{
        hostname    = $env:COMPUTERNAME
        os_version  = if ($os -and $os.Caption) { $os.Caption } else { $null }
        os_build    = if ($os -and $os.BuildNumber) { $os.BuildNumber } else { $null }
        arch        = if ($os -and $os.OSArchitecture) { $os.OSArchitecture } else { $null }
        cpu_model   = if ($cpu -and $cpu.Name) { $cpu.Name.Trim() } else { $null }
        cpu_cores   = if ($cpu -and $null -ne $cpu.NumberOfCores) { $cpu.NumberOfCores } else { $null }
        total_ram_gb = $totalRam
    }
}

function Get-LiveTelemetry {
    # Collector failures are unknown, NEVER a fabricated 5% CPU or 250GB disk.
    $cpuMetric = $null
    try {
        $cpuSamples = Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1 -ErrorAction Stop
        if ($cpuSamples -and $cpuSamples.CounterSamples.Count -gt 0) {
            $value = [double]$cpuSamples.CounterSamples[0].CookedValue
            if ($value -ge 0 -and $value -le 100) {
                $cpuMetric = [math]::Round($value, 1)
            }
        }
    } catch {
        try {
            $cimCpu = Get-CimInstance Win32_Processor -ErrorAction Stop |
                Measure-Object -Property LoadPercentage -Average
            if ($null -ne $cimCpu.Average) {
                $value = [double]$cimCpu.Average
                if ($value -ge 0 -and $value -le 100) {
                    $cpuMetric = [math]::Round($value, 1)
                }
            }
        } catch { $cpuMetric = $null }
    }

    $ramPct = $null
    $freeRamMB = $null
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        if ($os -and $null -ne $os.TotalVisibleMemorySize -and
            $null -ne $os.FreePhysicalMemory -and [double]$os.TotalVisibleMemorySize -gt 0) {
            $freeRamMB = [math]::Round(([double]$os.FreePhysicalMemory / 1024), 0)
            $totalRamMB = [double]$os.TotalVisibleMemorySize / 1024
            $usage = (1 - ([double]$os.FreePhysicalMemory / [double]$os.TotalVisibleMemorySize)) * 100
            if ($usage -ge 0 -and $usage -le 100) { $ramPct = [math]::Round($usage, 1) }
        }
    } catch { $ramPct = $null; $freeRamMB = $null }

    $diskTotalGB = $null
    $diskFreeGB = $null
    try {
        $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction Stop
        if ($disk -and $null -ne $disk.Size -and [double]$disk.Size -ge 0) {
            $diskTotalGB = [math]::Round(([double]$disk.Size / 1GB), 1)
        }
        if ($disk -and $null -ne $disk.FreeSpace -and [double]$disk.FreeSpace -ge 0) {
            $diskFreeGB = [math]::Round(([double]$disk.FreeSpace / 1GB), 1)
        }
    } catch { $diskTotalGB = $null; $diskFreeGB = $null }

    $ip = $null
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet*", "Wi-Fi*" -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike "169.254*" -and $_.IPAddress -ne "127.0.0.1" } |
            Select-Object -ExpandProperty IPAddress -First 1)
    } catch { $ip = $null }

    $netLatency = $null
    try {
        if ($Endpoint) {
            $ping = Test-Connection -ComputerName ([System.Uri]$Endpoint).Host -Count 1 -ErrorAction Stop
            if ($ping -and $null -ne $ping.ResponseTime) {
                $netLatency = [int]$ping.ResponseTime
            }
        }
    } catch { $netLatency = $null }

    return @{
        ip_address = $ip
        cpu = @{ utilization_pct = $cpuMetric }
        ram = @{ utilization_pct = $ramPct; free_mb = $freeRamMB }
        disk = @{ free_gb = $diskFreeGB; total_gb = $diskTotalGB }
        network = @{ latency_ms = $netLatency }
    }
}

function Get-TopProcesses {
    try {
        $procs = Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 25 | ForEach-Object {
            $procPath = if ($_.Path) { $_.Path } else { "System" }
            @{
                pid       = $_.Id
                name      = $_.ProcessName + ".exe"
                cpu_pct   = [math]::Round(($_.CPU / 10), 1)
                ram_mb    = [math]::Round($_.WorkingSet64 / 1MB, 1)
                path      = $procPath
                user      = $env:USERNAME
            }
        }
        return $procs
    } catch {
        return @()
    }
}

function Get-SecurityPosture {
    # An inaccessible or missing collector must report UNKNOWN. Enrollment,
    # Windows version and command failure do NOT imply a compliant device.
    $bitlocker = "UNKNOWN"
    try {
        $bl = Get-BitLockerVolume -MountPoint "C:" -ErrorAction Stop
        if ($bl -and $null -ne $bl.ProtectionStatus) {
            if ([int]$bl.ProtectionStatus -eq 1) { $bitlocker = "PROTECTED" }
            elseif ([int]$bl.ProtectionStatus -eq 0) { $bitlocker = "UNPROTECTED" }
        }
    } catch { $bitlocker = "UNKNOWN" }

    $avName = $null
    try {
        $av = Get-CimInstance -Namespace root\SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop |
            Select-Object -First 1
        if ($av -and $av.displayName) { $avName = [string]$av.displayName }
    } catch { $avName = $null }

    # A detected antivirus product is NOT proof its real-time protection is on.
    # Only a successful Defender status query can establish that state.
    $antivirus = "UNKNOWN"
    try {
        $mp = Get-MpComputerStatus -ErrorAction Stop
        if ($null -ne $mp.AntivirusEnabled -and $null -ne $mp.RealTimeProtectionEnabled) {
            if ($mp.AntivirusEnabled -and $mp.RealTimeProtectionEnabled) {
                $antivirus = "ACTIVE"
                if (-not $avName) { $avName = "Microsoft Defender Antivirus" }
            } else {
                $antivirus = "INACTIVE"
            }
        }
    } catch { $antivirus = "UNKNOWN" }

    $fwStatus = "UNKNOWN"
    try {
        $fwProfiles = @(Get-NetFirewallProfile -ErrorAction Stop)
        if ($fwProfiles.Count -gt 0) {
            if (@($fwProfiles | Where-Object { $_.Enabled -eq $false }).Count -gt 0) {
                $fwStatus = "DISABLED"
            } elseif (@($fwProfiles | Where-Object { $_.Enabled -eq $true }).Count -eq $fwProfiles.Count) {
                $fwStatus = "ENABLED"
            }
        }
    } catch { $fwStatus = "UNKNOWN" }

    # Missing evidence cannot generate a perfect score or compliance verdict.
    $score = $null
    if ($bitlocker -ne "UNKNOWN" -and $antivirus -ne "UNKNOWN" -and $fwStatus -ne "UNKNOWN") {
        $score = 100
        if ($bitlocker -ne "PROTECTED") { $score -= 30 }
        if ($antivirus -ne "ACTIVE") { $score -= 30 }
        if ($fwStatus -ne "ENABLED") { $score -= 20 }
        if ($score -lt 0) { $score = 0 }
    }

    return @{
        firewall_status   = $fwStatus
        antivirus_name    = $avName
        antivirus_status  = $antivirus
        bitlocker_status  = $bitlocker
        security_score    = $score
    }
}

function Send-TelemetryPayload {
    $hw = Get-HardwareDetails
    $tel = Get-LiveTelemetry
    $procs = Get-TopProcesses
    $sec = Get-SecurityPosture

    # One unique key per sample. Unlike the installed MSI worker, this
    # compatibility script has no durable outbox across process restarts.
    $batchId = [Guid]::NewGuid().ToString('N')
    $body = @{
        batch_id        = $batchId
        device_id       = $env:COMPUTERNAME
        hostname        = $env:COMPUTERNAME
        os_version      = $hw.os_version
        arch            = $hw.arch
        ip_address      = $tel.ip_address
        cpu_model       = $hw.cpu_model
        total_ram_gb    = $hw.total_ram_gb
        disk_total_gb   = $tel.disk.total_gb
        disk_free_gb    = $tel.disk.free_gb
        metrics         = $tel
        processes       = $procs
        posture         = $sec
        timestamp       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    }

    $jsonBody = $body | ConvertTo-Json -Depth 6
    $headers = @{
        "Content-Type"   = "application/json"
        "X-Device-Token" = $Token
        "Authorization"  = "Bearer $Token"
    }

    try {
        $response = Invoke-RestMethod -Uri $Endpoint -Method Post -Body $jsonBody -Headers $headers -TimeoutSec 15
        if (-not $response -or [string]$response.status -cne 'OK' -or
            [string]$response.batch_id -cne $batchId -or -not $response.recorded_at) {
            throw 'Telemetry receipt was missing or did not match this batch.'
        }
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [+] Telemetry uploaded successfully to $Endpoint" -ForegroundColor Green
        
        # Telemetry must never issue or install a replacement credential.
        # Use the supported installer and independently authorized recovery.
    } catch {
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [!] Upload warning: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Legacy standalone compatibility mode is telemetry-only. The obsolete
# remote execution loop (unsigned outer command.kind and unrestricted
# regex switch) was retired to avoid unapproved local privileged actions.

# Execution Loop
Write-Warning "Legacy AadiTech standalone agent is TELEMETRY-ONLY. Remote commands disabled; deploy verified installed MSI worker for signed command processing."
if ($Once) {
    Send-TelemetryPayload
    Write-Host "[INFO] Telemetry-only single pass finished; no command executed or repair verified." -ForegroundColor Cyan
    exit 0
}

while ($true) {
    Send-TelemetryPayload
    Start-Sleep -Seconds $Interval
}
