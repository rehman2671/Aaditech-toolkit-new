#Requires -Version 5.1
# Phase N45: a strictly LOCAL Windows filesystem capability for the separately
# consented public HTTPS /healthz operator diagnostic. No config, DNS, network,
# curl, credential, registry or customer production acceptance functionality.
Set-StrictMode -Version Latest
# N47: only response directories created in this module session may be
# finalized. Do not expose an unrestricted recursive delete primitive.
$script:ActivePrivateWindowsProbeWorkspaces = @{}

function New-PrivateWindowsProbeWorkspace {
    [CmdletBinding()]
    param()

    $directory = $null
    $createdDirectory = $false
    try {
        if ($env:OS -cne 'Windows_NT') { throw 'Windows platform required.' }

        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        if ($null -eq $identity -or $null -eq $identity.User) {
            throw 'Current Windows identity unavailable.'
        }
        $sid = $identity.User
        $system = [System.Security.Principal.SecurityIdentifier]::new(
            [System.Security.Principal.WellKnownSidType]::LocalSystemSid, $null)

        # Use the CURRENT account's local-app-data root rather than %TEMP%:
        # TEMP can be redirected to a public/attacker-owned folder or UNC path.
        # Reject all reparse/mount points in the chosen parent chain.
        $base = [Environment]::GetFolderPath(
            [Environment+SpecialFolder]::LocalApplicationData)
        if ([string]::IsNullOrWhiteSpace($base) -or
            -not [IO.Path]::IsPathRooted($base) -or
            $base.StartsWith('\\', [StringComparison]::Ordinal) -or
            -not (Test-Path -LiteralPath $base -PathType Container)) {
            throw 'Untrusted local workspace root.'
        }
        $cursor = [IO.Path]::GetFullPath($base)
        while (-not [string]::IsNullOrEmpty($cursor)) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Local workspace parent is redirected.'
            }
            $above = [IO.Path]::GetDirectoryName($cursor.TrimEnd('\'))
            if ([string]::IsNullOrWhiteSpace($above) -or $above -ceq $cursor) {
                break
            }
            $cursor = $above
        }

        # N46: prepare a protected owner/SYSTEM-only ACL *before* creating
        # the directory. N45 used Directory.CreateDirectory(path) followed by
        # Set-Acl, briefly inheriting permissions from the parent. That
        # pre-ACL interval is forbidden even in an account-local profile.
        # No non-atomic fallback is allowed on unsupported Windows runtimes.
        $acl = [System.Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetOwner($sid)
        $flags = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
                 [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
        foreach ($principal in @($sid, $system)) {
            $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                $principal,
                [System.Security.AccessControl.FileSystemRights]::FullControl,
                $flags,
                [System.Security.AccessControl.PropagationFlags]::None,
                [System.Security.AccessControl.AccessControlType]::Allow)
            $acl.AddAccessRule($rule)
        }

        $directory = [IO.Path]::Combine($base,
            ('aaditech-private-health-' + [guid]::NewGuid().ToString('N')))
        if (Test-Path -LiteralPath $directory) {
            throw 'Refusing preexisting health workspace.'
        }
        # Windows PowerShell 5.1 runs on .NET Framework, which exposes the
        # DirectorySecurity overload directly. PowerShell 7 runs on .NET,
        # where FileSystemAclExtensions provides atomic ACL-aware creation.
        # Both must apply the security descriptor in the CREATE operation.
        if ($PSVersionTable.PSVersion.Major -le 5) {
            $null = [IO.Directory]::CreateDirectory($directory, $acl)
        } else {
            $null = [System.IO.FileSystemAclExtensions]::CreateDirectory(
                $acl, $directory)
        }
        $createdDirectory = $true

        $actual = Get-Acl -LiteralPath $directory -ErrorAction Stop
        if (-not $actual.AreAccessRulesProtected -or
            -not $actual.GetOwner(
                [System.Security.Principal.SecurityIdentifier]).Equals($sid)) {
            throw 'Private workspace ACL owner or inheritance mismatch.'
        }
        $allowed = @($sid.Value, $system.Value)
        $rules = @($actual.GetAccessRules($true, $true,
            [System.Security.Principal.SecurityIdentifier]))
        if ($rules.Count -lt 1) { throw 'Private workspace has no access rules.' }
        $ownsFullAccess = $false
        foreach ($rule in $rules) {
            if ($rule.IsInherited -or
                $rule.AccessControlType -ne
                    [System.Security.AccessControl.AccessControlType]::Allow -or
                $allowed -cnotcontains $rule.IdentityReference.Value) {
                throw 'Private workspace includes an unauthorized access rule.'
            }
            if ($rule.IdentityReference.Value -ceq $sid.Value -and
                ($rule.FileSystemRights -band
                    [System.Security.AccessControl.FileSystemRights]::FullControl) -eq
                    [System.Security.AccessControl.FileSystemRights]::FullControl) {
                $ownsFullAccess = $true
            }
        }
        if (-not $ownsFullAccess) { throw 'Current operator lacks private workspace control.' }

        # Allocate exactly one response target exclusively; no attacker can
        # pre-place a symlink/junction in an inherited world-writable TEMP dir.
        $responsePath = [IO.Path]::Combine($directory, 'response.json')
        $file = [IO.File]::Open($responsePath, [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $file.Flush($true) } finally { $file.Dispose() }
        $leaf = Get-Item -LiteralPath $responsePath -Force -ErrorAction Stop
        if ($leaf -isnot [IO.FileInfo] -or
            ($leaf.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $leaf.Length -ne 0) {
            throw 'Private health response target invalid.'
        }
        $script:ActivePrivateWindowsProbeWorkspaces[$directory] = $responsePath
        return [pscustomobject]@{
            Directory = $directory
            ResponsePath = $responsePath
        }
    } catch {
        # Never delete a directory that was already present or whose atomic
        # creation failed. Only clean up a workspace this process created.
        if ($createdDirectory -and $null -ne $directory -and
            (Test-Path -LiteralPath $directory)) {
            Remove-Item -LiteralPath $directory -Force -Recurse -ErrorAction SilentlyContinue
        }
        # No local paths, owner/tenant identity, ACL details or tokens in
        # caller-facing logs or a redacted acceptance report.
        throw 'Private Windows health workspace policy blocked.'
    }
}

# N47: strict bounded cleanup. Success means BOTH the response file and
# private directory are gone. Do not report a healthy transport when a
# potentially sensitive health-response file remains on disk.
function Remove-PrivateWindowsProbeWorkspace {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][psobject]$Workspace)

    try {
        $directory = [string]$Workspace.Directory
        $responsePath = [string]$Workspace.ResponsePath
        if ([string]::IsNullOrWhiteSpace($directory) -or
            [string]::IsNullOrWhiteSpace($responsePath) -or
            -not $script:ActivePrivateWindowsProbeWorkspaces.ContainsKey($directory) -or
            $script:ActivePrivateWindowsProbeWorkspaces[$directory] -cne $responsePath) {
            throw 'Workspace was not created in this module session.'
        }
        # Only accept the same canonical LocalApplicationData child this
        # module produced. In particular, NEVER recurse into arbitrary paths.
        $base = [IO.Path]::GetFullPath([Environment]::GetFolderPath(
            [Environment+SpecialFolder]::LocalApplicationData))
        $parent = [IO.Path]::GetDirectoryName($directory)
        if (-not [string]::Equals($parent,$base,[StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($directory) -cnotmatch
                '^aaditech-private-health-[a-f0-9]{32}$' -or
            -not [string]::Equals([IO.Path]::GetDirectoryName($responsePath),
                $directory,[StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($responsePath) -cne 'response.json') {
            throw 'Workspace does not match expected local path.'
        }
        $dirInfo = Get-Item -LiteralPath $directory -Force -ErrorAction Stop
        if ($dirInfo -isnot [IO.DirectoryInfo] -or
            ($dirInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Workspace directory was replaced.'
        }
        # Never delete unexpected files/directories, nor follow a reparse
        # point. An unrecognized file means cleanup must fail closed and
        # remain subject to manual security investigation.
        $children = @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)
        if ($children.Count -gt 1 -or
            ($children.Count -eq 1 -and
             ($children[0] -isnot [IO.FileInfo] -or
              $children[0].Name -cne 'response.json' -or
              ($children[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0))) {
            throw 'Workspace contains unexpected files.'
        }
        if ($children.Count -eq 1) {
            [IO.File]::Delete($responsePath)
        }
        # A retry after a partial cleanup (response removed, directory lock
        # prevented deletion) may see an empty registered directory. Removing
        # that empty directory is safe; no arbitrary recursive cleanup occurs.
        [IO.Directory]::Delete($directory, $false)
        if (Test-Path -LiteralPath $directory) {
            throw 'Workspace still exists after cleanup.'
        }
        $script:ActivePrivateWindowsProbeWorkspaces.Remove($directory)
        return $true
    } catch {
        # Retain the session record on failures so the operator/test can
        # retry after a transient file lock clears; never disclose paths,
        # health contents or Windows identities in a report/error message.
        throw 'Private Windows health workspace cleanup blocked.'
    }
}

Export-ModuleMember -Function New-PrivateWindowsProbeWorkspace, Remove-PrivateWindowsProbeWorkspace
