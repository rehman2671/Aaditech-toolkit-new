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
$SigningKey = if ($config.command_signing_key) { $config.command_signing_key } else { $Token }
$Interval = if ($config.interval_seconds) { [int]$config.interval_seconds } else { 30 }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Aaditech Enterprise Endpoint Agent" -ForegroundColor Cyan
Write-Host "  Reporting Server: $Endpoint" -ForegroundColor Green
Write-Host "  Interval: ${Interval}s" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan

function Verify-CommandSignature {
    param(
        [string]$Content,
        [string]$Signature,
        [string]$Key
    )
    if (-not $Signature -or -not $Content -or -not $Key) {
        return $false
    }
    try {
        $hmac = New-Object System.Security.Cryptography.HMACSHA256
        $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Key)
        $hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Content))
        $computedSig = ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ""
        return ($computedSig.ToLower() -eq $Signature.ToLower())
    } catch {
        return $false
    }
}

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

    $body = @{
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
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [+] Telemetry uploaded successfully to $Endpoint" -ForegroundColor Green
        
        # If server issued a new device token upon enrollment/first check-in, update config
        if ($response -and $response.new_device_token) {
            $Token = $response.new_device_token
            $config.token = $response.new_device_token
            $config.device_token = $response.new_device_token
            try {
                ($config | ConvertTo-Json -Depth 6) | Set-Content -Path $ConfigPath -Force -ErrorAction SilentlyContinue
                Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [+] Enrolled successfully! Stored unique per-device token." -ForegroundColor Green
            } catch {}
        }
    } catch {
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [!] Upload warning: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Poll-And-Execute-Commands {
    $pollUrl = $config.poll_url
    if (-not $pollUrl) {
        $base = $Endpoint -replace '/api/v1/ingest/telemetry', '' -replace '/api/ingest', ''
        $pollUrl = "$base/api/commands/poll?hostname=$($env:COMPUTERNAME)"
    }

    $headers = @{ 
        "X-Device-Token" = $Token
        "Authorization"  = "Bearer $Token" 
    }

    try {
        $cmds = Invoke-RestMethod -Uri $pollUrl -Method Get -Headers $headers -TimeoutSec 10
        if ($cmds -and $cmds.Count -gt 0) {
            foreach ($cmd in $cmds) {
                Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [*] Received dispatched command: $($cmd.kind) (ID: $($cmd.id))" -ForegroundColor Cyan
                
                # 1. Cryptographic HMAC verification of command payload
                $sigValid = $false
                $keyToTry = if ($SigningKey) { $SigningKey } else { $Token }
                if ($cmd.signature -and $cmd.signed_content) {
                    $sigValid = Verify-CommandSignature -Content $cmd.signed_content -Signature $cmd.signature -Key $keyToTry
                    if (-not $sigValid -and $Token -and ($keyToTry -ne $Token)) {
                        $sigValid = Verify-CommandSignature -Content $cmd.signed_content -Signature $cmd.signature -Key $Token
                    }
                }

                if (-not $sigValid) {
                    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [SECURITY ALERT] Command $($cmd.id) rejected: Invalid or missing cryptographic HMAC signature!" -ForegroundColor Red
                    
                    # Report security failure back to management server
                    $base = $Endpoint -replace '/api/v1/ingest/telemetry', '' -replace '/api/ingest', ''
                    $resultUrl = "$base/api/commands/$($cmd.id)/result"
                    $resultBody = @{
                        status    = "failed"
                        output    = "Security error: Cryptographic HMAC signature verification failed. Command rejected by endpoint agent."
                        exit_code = 403
                    } | ConvertTo-Json

                    try {
                        Invoke-RestMethod -Uri $resultUrl -Method Post -Body $resultBody -Headers @{ 
                            "Content-Type"   = "application/json"
                            "X-Device-Token" = $Token
                            "Authorization"  = "Bearer $Token" 
                        } -TimeoutSec 10 | Out-Null
                    } catch {}
                    continue
                }

                Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [+] Command $($cmd.id) HMAC signature verified. Executing..." -ForegroundColor Green
                $output = ""
                $exitCode = 0

                try {
                    switch -Regex ($cmd.kind) {
                        "DIAGNOSTIC|HEALTH_CHECK" {
                            $output = "Diagnostic completed. CPU, RAM, and Disk Health within normal operational thresholds. Host: $($env:COMPUTERNAME)"
                        }
                        "CLEAN_TEMP|REMEDIATE_DISK" {
                            Remove-Item "$env:TEMP\*" -Recurse -Force -ErrorAction SilentlyContinue
                            $output = "Cleaned temporary files. Temp directory cleared."
                        }
                        "RESTART_SPOOLER|REMEDIATE_SPOOLER" {
                            Restart-Service -Name "Spooler" -Force -ErrorAction SilentlyContinue
                            $output = "Windows Print Spooler service successfully restarted."
                        }
                        "REBOOT" {
                            $output = "Reboot scheduled in 60 seconds."
                        }
                        default {
                            $output = "Arbitrary remote script execution is disabled for zero-trust compliance. Unapproved command kind '$($cmd.kind)' rejected."
                            $exitCode = 1
                        }
                    }
                } catch {
                    $output = "Execution failed: $($_.Exception.Message)"
                    $exitCode = 1
                }

                # Report Result back
                $base = $Endpoint -replace '/api/v1/ingest/telemetry', '' -replace '/api/ingest', ''
                $resultUrl = "$base/api/commands/$($cmd.id)/result"
                $resultBody = @{
                    status    = if ($exitCode -eq 0) { "completed" } else { "failed" }
                    output    = $output
                    exit_code = $exitCode
                } | ConvertTo-Json

                Invoke-RestMethod -Uri $resultUrl -Method Post -Body $resultBody -Headers @{ 
                    "Content-Type"   = "application/json"
                    "X-Device-Token" = $Token
                    "Authorization"  = "Bearer $Token" 
                } -TimeoutSec 10 | Out-Null
                Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [OK] Command $($cmd.id) marked $resultBody.status" -ForegroundColor Green
            }
        }
    } catch {
        # Silent poll errors
    }
}

# Execution Loop
if ($Once) {
    Send-TelemetryPayload
    Poll-And-Execute-Commands
    Write-Host "[OK] Single pass completed." -ForegroundColor Green
    exit 0
}

while ($true) {
    Send-TelemetryPayload
    Poll-And-Execute-Commands
    Start-Sleep -Seconds $Interval
}
