#Requires -Version 5.1
<#
.SYNOPSIS
  Windows graphical first-run and reconfiguration wizard for the generic MSI.
.DESCRIPTION
  Launch as an Administrator with Windows PowerShell 5.1 and -STA. The
  installer never stores a server address or bootstrap token at build time.
  This UI delegates all validation and credential storage to Configure-Agent.ps1.
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $env:ProgramData 'ITToolkit-Agent\agent.json')
)
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'Graphical setup is available on Windows only.'
}
if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    throw 'Start this wizard using Windows PowerShell with -STA.'
}

# Elevation is needed for ProgramData ACLs and device identity reset. Ask
# Windows for UAC consent; never request or store an administrator password.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $thisScript = $MyInvocation.MyCommand.Path
    if ($thisScript -match '"') { throw 'Unsupported path containing a quote character.' }
    $arguments = "-NoProfile -ExecutionPolicy Bypass -STA -File `"$thisScript`""
    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $arguments -Verb RunAs
    return
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'IT-Toolkit Agent — Server Setup'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(590, 358)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

function Add-WizardLabel([string]$text, [int]$x, [int]$y, [int]$w) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $text
    $label.Location = New-Object System.Drawing.Point($x, $y)
    $label.Size = New-Object System.Drawing.Size($w, 24)
    $form.Controls.Add($label)
    return $label
}
$heading = Add-WizardLabel 'Configure your AadiTech server' 20 16 545
$heading.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)

$description = Add-WizardLabel 'Set the HTTPS server URL after deployment. Re-run to change servers later.' 20 48 555
$description.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$description.ForeColor = [System.Drawing.Color]::DimGray

$null = Add-WizardLabel 'Server URL' 20 88 535
$urlBox = New-Object System.Windows.Forms.TextBox
$urlBox.Location = New-Object System.Drawing.Point(20, 115)
$urlBox.Size = New-Object System.Drawing.Size(550, 29)
$form.Controls.Add($urlBox)

$null = Add-WizardLabel 'Single-use device enrollment token (hidden)' 20 156 540
$tokenBox = New-Object System.Windows.Forms.TextBox
$tokenBox.Location = New-Object System.Drawing.Point(20, 182)
$tokenBox.Size = New-Object System.Drawing.Size(550, 29)
$tokenBox.UseSystemPasswordChar = $true
$form.Controls.Add($tokenBox)

$healthCheck = New-Object System.Windows.Forms.CheckBox
$healthCheck.Text = 'Verify HTTPS certificate and database health before saving'
$healthCheck.Location = New-Object System.Drawing.Point(20, 222)
$healthCheck.Size = New-Object System.Drawing.Size(550, 25)
$healthCheck.Checked = $true
$form.Controls.Add($healthCheck)

$clearOverride = New-Object System.Windows.Forms.CheckBox
$clearOverride.Text = 'Clear old machine-policy endpoint overrides (if present)'
$clearOverride.Location = New-Object System.Drawing.Point(20, 250)
$clearOverride.Size = New-Object System.Drawing.Size(550, 24)
$form.Controls.Add($clearOverride)

$status = Add-WizardLabel 'Use a tenant-scoped token issued by your server administrator.' 20 278 548
$status.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$status.ForeColor = [System.Drawing.Color]::DimGray

$save = New-Object System.Windows.Forms.Button
$save.Text = 'Save and Configure Agent'
$save.Location = New-Object System.Drawing.Point(308, 310)
$save.Size = New-Object System.Drawing.Size(262, 34)
$form.Controls.Add($save)
$form.AcceptButton = $save

# Only the previous server origin is read, never saved or displayed credentials.
try {
    if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
        $existing = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
        if ($existing.endpoint) {
            $urlBox.Text = ([uri]$existing.endpoint).GetLeftPart([UriPartial]::Authority)
        }
    }
} catch { }

$save.Add_Click({
    $save.Enabled = $false
    $status.Text = 'Validating the server and saving configuration...'
    $status.ForeColor = [System.Drawing.Color]::DimGray
    $secret = $null
    try {
        if ([string]::IsNullOrWhiteSpace($urlBox.Text) -or
            [string]::IsNullOrWhiteSpace($tokenBox.Text)) {
            throw 'Both HTTPS server URL and enrollment token are required.'
        }

        # Avoid command-line arguments, temp files, PowerShell history and logs.
        $secret = ConvertTo-SecureString -String $tokenBox.Text -AsPlainText -Force
        $params = @{
            ServerUrl = $urlBox.Text
            EnrollmentToken = $secret
            ConfigPath = $ConfigPath
            NonInteractive = $true
            TestConnection = [bool]$healthCheck.Checked
            ClearRegistryOverride = [bool]$clearOverride.Checked
        }
        & (Join-Path $PSScriptRoot 'Configure-Agent.ps1') @params | Out-Null

        $tokenBox.Clear()
        $status.Text = 'Configured successfully. Agent will enroll on its next run.'
        $status.ForeColor = [System.Drawing.Color]::DarkGreen
        [System.Windows.Forms.MessageBox]::Show(
            'Configuration saved. Your token was not printed. You can rerun this wizard to change the server.',
            'AadiTech Agent', 'OK', 'Information') | Out-Null
    } catch {
        $tokenBox.Clear()
        $status.Text = 'Setup failed — no connection established. See error message.'
        $status.ForeColor = [System.Drawing.Color]::DarkRed
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message, 'Agent Setup Error', 'OK', 'Error') | Out-Null
    } finally {
        if ($secret) { $secret.Dispose() }
        $save.Enabled = $true
    }
})

[void]$form.ShowDialog()
$form.Dispose()
