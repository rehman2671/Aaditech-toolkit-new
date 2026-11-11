# Phase J security regression tests: the routine agent may NEVER delegate
# privileges to SYSTEM using an agent-writable request file. PowerShell 5.1.
BeforeAll {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:agent = Get-Content (Join-Path $root 'Enterprise\agent\Agent-Collect.ps1') -Raw
    $script:wix = Get-Content (Join-Path $root 'Enterprise\agent\wix\Agent.wxs') -Raw
    $script:builder = Get-Content (Join-Path $root 'Enterprise\agent\wix\build-msi.ps1') -Raw
    $script:helper = Get-Content (Join-Path $root 'Enterprise\agent\wix\Create-ElevatedTask.ps1') -Raw
    $script:removal = Get-Content (Join-Path $root 'Enterprise\agent\wix\Remove-LegacyElevatedTask.ps1') -Raw
}

Describe 'Phase J: no untrusted SYSTEM elevation' {
    It 'rejects the legacy ElevatedOnce switch before doing agent work' {
        $script:agent | Should -Match '(?s)if \(\$ElevatedOnce\).*?exit 77'
        $guardPos = $script:agent.IndexOf('if ($ElevatedOnce)')
        $initPos = $script:agent.LastIndexOf('Import-ToolkitModules')
        $guardPos | Should -BeGreaterThan 0
        $initPos | Should -BeGreaterThan $guardPos
    }

    It 'does not execute unauthenticated reboot, MSI upgrade or scheduled SYSTEM task' {
        $script:agent | Should -Not -Match 'schtasks\.exe\s+/run\s+/tn\s+ITToolkitAgentElevated'
        $script:agent | Should -Not -Match 'Start-Process\s+msiexec\.exe'
        $script:agent | Should -Not -Match 'Restart-Computer\s+-Force'
        $script:agent | Should -Not -Match 'Get-ElevatedTaskRequestPath'
        $script:agent | Should -Not -Match 'Clear-ElevatedRequest'
        $script:agent | Should -Match "Automatic agent MSI updates disabled"
        $script:agent | Should -Match "Remote reboot disabled pending administrator-approved"
    }

    It 'does not compile a SYSTEM scheduled task registration in the MSI' {
        $script:wix | Should -Not -Match 'Id="CreateElevatedTask"'
        $script:wix | Should -Not -Match 'ComponentRef Id="ElevTaskHelper"'
        $script:wix | Should -Match 'CustomAction Id="DisableLegacyElevatedTask"'
        $script:wix | Should -Match '(?s)Id="DisableLegacyElevatedTask".*?Return="check"'
        $script:wix | Should -Match 'Remove-LegacyElevatedTask\.ps1'
        $script:builder | Should -Match 'Copy-Item.*Remove-LegacyElevatedTask\.ps1'
        $script:wix | Should -Match 'Custom Action="DisableLegacyElevatedTask"'
        $script:wix | Should -Match 'schtasks\.exe&quot; /delete /tn ITToolkitAgentElevated /f'
        $script:builder | Should -Not -Match "Copy-Item.*Create-ElevatedTask\.ps1"
    }

    It 'does not proceed if MSI credential-directory ACL hardening fails' {
        $script:wix | Should -Match '(?s)Id="HardenAgentDataAcl".*?Return="check"'
        $script:wix | Should -Match '(?s)Id="HardenLocalJsonAcl".*?Return="check"'
        $script:wix | Should -Match 'Custom Action="CreateSchedTask" After="DisableLegacyElevatedTask"'
    }

    It 'requires verified removal and aborts if the legacy task survives' {
        $script:removal | Should -Match 'Import-Module ScheduledTasks -ErrorAction Stop'
        $script:removal | Should -Match 'Unregister-ScheduledTask -TaskPath \$taskPath'
        $script:removal | Should -Match 'SECURITY_BLOCK: cannot delete legacy SYSTEM task'
        $script:removal | Should -Match 'SECURITY_BLOCK: legacy SYSTEM task'
        $script:removal | Should -Match 'if \(\$remaining\.Count -ne 0\)'
    }

    It 'keeps the legacy registration script as a safe, nonfunctional stub' {
        $script:helper | Should -Match "throw 'SECURITY_BLOCK:"
        $script:helper | Should -Not -Match 'RegisterTask\('
        $script:helper | Should -Not -Match 'New-Object -ComObject Schedule\.Service'
    }
}
