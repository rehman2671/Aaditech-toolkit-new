#Requires -Version 5.1
# N62: exact Windows compiler/toolchain version admission for ALL MSI builds.
# Version pins constrain supply-chain drift, but are not package SHA
# attestations and do not replace N54-N61 signed release approvals.
Set-StrictMode -Version Latest

function Get-N62BuildToolchainLock {
    [CmdletBinding()]
    param()
    try {
        $path = Join-Path $PSScriptRoot 'toolchain-lock.json'
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        if ($item -isnot [IO.FileInfo] -or
            ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $item.Length -lt 25 -or $item.Length -gt 256) {
            throw 'Invalid compiler lock file.'
        }
        $lock=Get-Content -LiteralPath $path -Raw -ErrorAction Stop |
            ConvertFrom-Json -ErrorAction Stop
        $props=@($lock.PSObject.Properties.Name)
        if ($props.Count -ne 2 -or
            $props -cnotcontains 'ps2exe' -or
            $props -cnotcontains 'wix' -or
            [string]$lock.ps2exe -cnotmatch '\A(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\z' -or
            [string]$lock.wix -cnotmatch '\A(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\z') {
            throw 'Invalid or floating toolchain versions.'
        }
        return $lock
    } catch {
        throw 'N62 approved build toolchain lock blocked.'
    }
}

function Assert-N62BuildToolchainVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][ValidateSet('ps2exe','wix')][string]$Kind,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ObservedVersion
    )
    try {
        $lock=Get-N62BuildToolchainLock
        $expected=if ($Kind -ceq 'ps2exe') { [string]$lock.ps2exe } else { [string]$lock.wix }
        if ($Kind -ceq 'ps2exe') {
            if ($ObservedVersion -cne $expected) {
                throw 'Unexpected PS2EXE module version.'
            }
        } else {
            # WiX CLI may append an informational assembly build SHA,
            # but the entire semantic version MUST equal the approved pin.
            if ($ObservedVersion -cnotmatch ('\A'+[regex]::Escape($expected)+'(?:\+[0-9A-Za-z.-]{1,96})?\z')) {
                throw 'Unexpected WiX executable version.'
            }
        }
        return $true
    } catch {
        throw 'N62 build toolchain version check blocked.'
    }
}

function Assert-N62InstalledPs2Exe {
    [CmdletBinding()]
    param()
    try {
        if ($env:OS -cne 'Windows_NT') { throw 'Windows PowerShell is required.' }
        $lock=Get-N62BuildToolchainLock
        $protected=($env:GITHUB_ACTIONS -ceq 'true' -and
                    $env:GITHUB_EVENT_NAME -ceq 'workflow_dispatch')
        if ($protected) {
            # N63 never import a same-version module found earlier in
            # PSModulePath. The archived source was SHA-approved and copied
            # into this explicit path by Install-ApprovedCompiler.ps1.
            $moduleBase=Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('WindowsPowerShell\Modules\ps2exe\'+$lock.ps2exe)
            $approvedManifest=Join-Path $moduleBase 'ps2exe.psd1'
            if ([string]::IsNullOrWhiteSpace($env:N63_PS2EXE_MANIFEST_PATH) -or
                $env:N63_PS2EXE_MANIFEST_PATH -cne $approvedManifest -or
                -not (Test-Path -LiteralPath $approvedManifest -PathType Leaf)) {
                throw 'Protected build must load the exact approved package module.'
            }
            Import-Module -Name $approvedManifest -RequiredVersion ([version]$lock.ps2exe) -Force -ErrorAction Stop
        } else {
            Import-Module -Name ps2exe -RequiredVersion ([version]$lock.ps2exe) -Force -ErrorAction Stop
        }
        $loaded=@(Get-Module -Name ps2exe)
        $command=Get-Command -Name ps2exe -ErrorAction Stop
        if ($protected -and ($loaded.Count -ne 1 -or
            [IO.Path]::GetFullPath($loaded[0].ModuleBase) -cne [IO.Path]::GetFullPath($moduleBase))) {
            throw 'Loaded PS2EXE module does not come from reviewed package path.'
        }
        if ($loaded.Count -ne 1 -or
            $command.ModuleName -cne 'ps2exe' -or
            $command.CommandType -ne [Management.Automation.CommandTypes]::Alias) {
            throw 'Compiler command was not exported by authentic loaded PS2EXE module.'
        }
        $null=Assert-N62BuildToolchainVersion -Kind ps2exe -ObservedVersion ([string]$loaded[0].Version)
        Write-Host 'N62 pinned Windows PS2EXE compiler version confirmed.'
        return $true
    } catch {
        throw 'N62 authentic Windows PS2EXE compiler admission blocked.'
    }
}

function Assert-N62InstalledWix {
    [CmdletBinding()]
    param()
    try {
        if ($env:OS -cne 'Windows_NT') { throw 'Windows WiX build is required.' }
        $command=Get-Command -Name wix -CommandType Application -ErrorAction Stop
        $observed=(& $command.Source --version 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($observed)) {
            throw 'WiX version could not be verified.'
        }
        $null=Assert-N62BuildToolchainVersion -Kind wix -ObservedVersion $observed
        Write-Host 'N62 pinned Windows WiX compiler version confirmed.'
        return $true
    } catch {
        throw 'N62 authentic Windows WiX toolset admission blocked.'
    }
}
Export-ModuleMember -Function Get-N62BuildToolchainLock,Assert-N62BuildToolchainVersion,Assert-N62InstalledPs2Exe,Assert-N62InstalledWix
