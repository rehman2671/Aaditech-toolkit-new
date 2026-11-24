#Requires -Version 5.1
# Local-only reference observation; no file writes, elevation, network
# transfer, service changes, credential reads, installer or DB invocation.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$TargetDirectory,
    [Parameter(Mandatory=$true)][string]$DatabaseMarker,
    [Parameter(Mandatory=$true)][string]$CredentialMarker,
    [Parameter(Mandatory=$true)][string]$ServiceName,
    [Parameter(Mandatory=$true)][int[]]$Ports,
    [Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$MinCpu,
    [Parameter(Mandatory=$true)][ValidateRange(1,[long]::MaxValue)][long]$MinMemoryBytes,
    [Parameter(Mandatory=$true)][ValidateRange(1,[long]::MaxValue)][long]$MinFreeBytes
)
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_HOST_REQUIRED' }
if ($Ports.Count -lt 1 -or $Ports.Count -gt 32 -or
    @($Ports | Where-Object { $_ -lt 1 -or $_ -gt 65535 }).Count -ne 0 -or
    @($Ports | Select-Object -Unique).Count -ne $Ports.Count -or
    $ServiceName -cnotmatch '\A[A-Za-z0-9_.-]{1,128}\z') { throw 'EXPLICIT_HOST_POLICY_REQUIRED' }

function Assert-LocalPath {
    param([string]$Path)
    # Exclude UNC, provider paths, device paths, alternate data streams,
    # drive-relative and traversal paths before any filesystem observation.
    if ($Path -cnotmatch '\A[A-Za-z]:\\(?:[^\\/:*?"<>|\x00-\x1f]+\\)*[^\\/:*?"<>|\x00-\x1f]*\z' -or
        $Path.Substring(3).Split('\') -contains '..' -or
        $Path.Substring(3).Split('\') -contains '.') { throw 'LOCAL_PATH_REQUIRED' }
    $full=[IO.Path]::GetFullPath($Path)
    if (-not [string]::Equals($full.TrimEnd('\'),$Path.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'LOCAL_PATH_REQUIRED' }
    $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($full))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'LOCAL_FIXED_DRIVE_REQUIRED' }
    return $full
}
function Get-LocalPathObservation {
    param([string]$Path,[switch]$Directory)
    try {
        $full=Assert-LocalPath $Path
        # Walk from drive root, not from the leaf; do not inspect through
        # a junction/symlink/reparse ancestor. No Get-Content.
        $root=[IO.Path]::GetPathRoot($full)
        $parts=$full.Substring($root.Length).Split('\',[StringSplitOptions]::RemoveEmptyEntries)
        $current=$root
        $rootItem=Get-Item -LiteralPath $root -Force
        if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return 'UNKNOWN' }
        for ($i=0;$i -lt $parts.Count;$i++) {
            $current=Join-Path $current $parts[$i]
            try { $item=Get-Item -LiteralPath $current -Force -ErrorAction Stop }
            catch [System.Management.Automation.ItemNotFoundException] { return 'NOT_OBSERVED' }
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return 'UNKNOWN' }
            if ($i -lt ($parts.Count-1) -and -not $item.PSIsContainer) { return 'UNKNOWN' }
            if ($i -eq ($parts.Count-1) -and $Directory -and -not $item.PSIsContainer) { return 'UNKNOWN' }
        }
        return 'PRESENT'
    } catch { return 'UNKNOWN' }
}

# Validate all paths before reading local metadata; invalid inputs are fatal.
$target=Assert-LocalPath $TargetDirectory
$db=Assert-LocalPath $DatabaseMarker
$credential=Assert-LocalPath $CredentialMarker
$osState='UNKNOWN';$cpuState='UNKNOWN';$memoryState='UNKNOWN'
$privilege='UNKNOWN';$disk='UNKNOWN';$serviceState='UNKNOWN';$portsState=$null
try {
    $os=Get-CimInstance -ClassName Win32_OperatingSystem -OperationTimeoutSec 10
    if ($os.ProductType -in @(2,3)) { $osState='WINDOWS_SERVER_OBSERVED' }
    elseif ($os.ProductType -eq 1) { $osState='WINDOWS_CLIENT_OBSERVED' }
} catch {}
try {
    $computer=Get-CimInstance -ClassName Win32_ComputerSystem -OperationTimeoutSec 10
    if ([long]$computer.NumberOfLogicalProcessors -gt 0) {
        $cpuState=if ([long]$computer.NumberOfLogicalProcessors -ge $MinCpu) {'MEETS_INPUT_THRESHOLD'} else {'INSUFFICIENT'}
    }
    if ([long]$computer.TotalPhysicalMemory -gt 0) {
        $memoryState=if ([long]$computer.TotalPhysicalMemory -ge $MinMemoryBytes) {'MEETS_INPUT_THRESHOLD'} else {'INSUFFICIENT'}
    }
} catch {}
try {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $principal=[Security.Principal.WindowsPrincipal]::new($identity)
        $privilege=if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {'ADMIN_OBSERVED'} else {'NOT_ADMIN'}
    } finally {$identity.Dispose()}
} catch {}
try {
    if ((Get-LocalPathObservation -Path $target -Directory) -eq 'PRESENT') {
        $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($target))
        # Drive-root observation does not prove a mounted filesystem quota,
        # target-directory ACL or future capacity.
        $disk=if ($drive.AvailableFreeSpace -ge $MinFreeBytes) {'MEETS_INPUT_THRESHOLD'} else {'INSUFFICIENT'}
    }
} catch {}
try {
    # Exact name, no wildcard query. A missing result is not proof of
    # resource absence or absence of another installation under another name.
    $matches=@(Get-Service -Name $ServiceName -ErrorAction Stop | Where-Object {$_.Name -ieq $ServiceName})
    if ($matches.Count -eq 1) {$serviceState='PRESENT'}
} catch {}
try {
    $listeners=[Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    $portsState=@($listeners | ForEach-Object {$_.Port})
} catch {}
$portChecks=@(foreach ($port in $Ports) {
    $state=if ($null -eq $portsState) {'UNKNOWN'} elseif ($portsState -contains $port) {'LISTENER_OBSERVED'} else {'NO_LISTENER_OBSERVED'}
    @{port=$port;state=$state}
})
[ordered]@{
    schema_version=1
    decision='EXTERNAL_APPROVAL_REQUIRED'
    checks=@(
        @{id='reference_platform';state=$osState}
        @{id='privilege';state=$privilege}
        @{id='cpu';state=$cpuState}
        @{id='physical_memory';state=$memoryState}
        @{id='drive_root_space';state=$disk}
    )
    ports=$portChecks
    markers=@{database=(Get-LocalPathObservation -Path $db);credentials=(Get-LocalPathObservation -Path $credential);service=$serviceState}
    runtime_compatibility_verified=$false
    resource_absence_verified=$false
    port_reservation_verified=$false
    installation_authorized=$false
} | ConvertTo-Json -Depth 6 -Compress
