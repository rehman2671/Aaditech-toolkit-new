#Requires -Version 5.1
# N63: independent human-approved exact NUPKG SHA256 before executing
# any downloaded build tool. This module is pure offline attestation.
Set-StrictMode -Version Latest

function Assert-N63ApprovedCompilerPackage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][ValidateSet('ps2exe','wix')][string]$Kind,
        [Parameter(Mandatory=$true)][string]$PackagePath,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedSha256
    )
    try {
        if ($env:OS -cne 'Windows_NT' -or
            $ApprovedSha256 -cnotmatch '\A[0-9A-Fa-f]{64}\z') {
            throw 'Unapproved package identity or operating system.'
        }
        Import-Module -Name (Join-Path $PSScriptRoot 'BuildToolchainLock.psm1') -Force -ErrorAction Stop
        $lock=Get-N62BuildToolchainLock
        $version=if ($Kind -ceq 'ps2exe') { [string]$lock.ps2exe } else { [string]$lock.wix }
        $pkg=Get-Item -LiteralPath $PackagePath -Force -ErrorAction Stop
        $maxBytes=if ($Kind -ceq 'ps2exe') { 16777216L } else { 268435456L }
        if ($pkg -isnot [IO.FileInfo] -or
            $pkg.Name -cne ($Kind+'.'+$version+'.nupkg') -or
            ($pkg.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $pkg.Length -le 0 -or $pkg.Length -gt $maxBytes) {
            throw 'Package path, type, version or size invalid.'
        }
        $actual=(Get-FileHash -LiteralPath $pkg.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
        if ($actual -cne $ApprovedSha256.ToUpperInvariant()) {
            throw 'Compiler package bytes differ from independent approval.'
        }
        return $true
    } catch {
        # Protected jobs must never log an approval hash or machine path.
        throw 'N63 independently approved compiler NUPKG verification blocked.'
    }
}

function Assert-N63ProtectedCompilerContext {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$Ps2ExeApprovedSha256,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$WixApprovedSha256
    )
    try {
        if ($env:OS -cne 'Windows_NT' -or
            $env:GITHUB_ACTIONS -cne 'true' -or
            $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
            $env:GITHUB_REF -cne 'refs/heads/main' -or
            $env:GITHUB_REPOSITORY -cnotmatch '\A[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\z' -or
            $Ps2ExeApprovedSha256 -cnotmatch '\A[0-9a-fA-F]{64}\z' -or
            $WixApprovedSha256 -cnotmatch '\A[0-9a-fA-F]{64}\z') {
            throw 'Manual protected main and both independently vetted packages required.'
        }
        return $true
    } catch {
        throw 'N63 protected compiler download authorization blocked.'
    }
}

Export-ModuleMember -Function Assert-N63ApprovedCompilerPackage,Assert-N63ProtectedCompilerContext
