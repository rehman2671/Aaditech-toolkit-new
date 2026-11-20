#Requires -Version 5.1
# Phase N45: a strictly LOCAL Windows filesystem capability for the separately
# consented public HTTPS /healthz operator diagnostic. No config, DNS, network,
# curl, credential, registry or customer production acceptance functionality.
Set-StrictMode -Version Latest

function New-PrivateWindowsProbeWorkspace {
    [CmdletBinding()]
    param()

    $directory = $null
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

        $directory = [IO.Path]::Combine($base,
            ('aaditech-private-health-' + [guid]::NewGuid().ToString('N')))
        if (Test-Path -LiteralPath $directory) {
            throw 'Refusing preexisting health workspace.'
        }
        $null = [IO.Directory]::CreateDirectory($directory)

        # Prevent cross-user TEMP responders and inherited Users/Everyone
        # grants. The path is randomized; the ACL is set/verified BEFORE curl
        # could write even a byte. Administrators still have OS take-ownership
        # powers; this is not defense against SYSTEM or a compromised operator.
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
        Set-Acl -LiteralPath $directory -AclObject $acl -ErrorAction Stop

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
        return [pscustomobject]@{
            Directory = $directory
            ResponsePath = $responsePath
        }
    } catch {
        if ($null -ne $directory -and (Test-Path -LiteralPath $directory)) {
            Remove-Item -LiteralPath $directory -Force -Recurse -ErrorAction SilentlyContinue
        }
        # No local paths, owner/tenant identity, ACL details or tokens in
        # caller-facing logs or a redacted acceptance report.
        throw 'Private Windows health workspace policy blocked.'
    }
}

Export-ModuleMember -Function New-PrivateWindowsProbeWorkspace
