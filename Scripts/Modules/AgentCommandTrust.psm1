# AgentCommandTrust.psm1 -- PowerShell 5.1-compatible, fail-closed HMAC check.
# A per-device verification key is delivered only through authorized enrollment.
# This module never accepts the server's global fleet command master secret.

function Test-AgentSignedCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Command,
        [string]$CommandKey,
        [string]$DeviceId,
        [string]$Hostname,
        [long]$NowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    )

    if ([string]::IsNullOrWhiteSpace($CommandKey) -or $CommandKey -notmatch '^[0-9a-fA-F]{64}$') { return $null }
    if ([string]::IsNullOrWhiteSpace($DeviceId) -or [string]::IsNullOrWhiteSpace($Hostname)) { return $null }
    if ($null -eq $Command -or [string]::IsNullOrWhiteSpace([string]$Command.signed_content) -or
        [string]::IsNullOrWhiteSpace([string]$Command.signature)) { return $null }
    $signature = [string]$Command.signature
    $content = [string]$Command.signed_content
    if ($signature -notmatch '^[0-9a-fA-F]{64}$' -or $content.Length -gt 65536) { return $null }

    $keyBytes = [System.Text.Encoding]::UTF8.GetBytes($CommandKey)
    $message = [System.Text.Encoding]::UTF8.GetBytes($content)
    $hmac = New-Object System.Security.Cryptography.HMACSHA256 (,[byte[]]$keyBytes)
    try { $expected = $hmac.ComputeHash($message) }
    finally { $hmac.Dispose() }

    $actual = New-Object byte[] 32
    try {
        for ($i = 0; $i -lt 32; $i++) {
            $actual[$i] = [Convert]::ToByte($signature.Substring($i * 2, 2), 16)
        }
    } catch { return $null }
    # Deliberately compare every byte to avoid leaking HMAC prefix matches.
    $different = 0
    for ($i = 0; $i -lt 32; $i++) {
        $different = $different -bor ($expected[$i] -bxor $actual[$i])
    }
    if ($different -ne 0) { return $null }

    try {
        $signed = ConvertFrom-Json -InputObject $content -ErrorAction Stop
        if ([int]$signed.protocol_version -ne 1) { return $null }
        if ([string]$signed.device_id -cne $DeviceId) { return $null }
        if ([string]$signed.hostname -ine $Hostname) { return $null }
        if ([string]$signed.id -cne [string]$Command.id) { return $null }
        if ($signed.kind -notin @('reboot','wake','run-script')) { return $null }
        if ($null -eq $signed.payload -or $signed.payload -is [array] -or
            $signed.payload -isnot [PSCustomObject]) { return $null }

        $issued = [long]$signed.issued_at
        $expires = [long]$signed.expires_at
        if ($issued -gt ($NowMs + 60000) -or $expires -le $NowMs -or
            $expires -gt ($issued + 300000) -or $issued -lt ($NowMs - 360000)) { return $null }
        if ($null -ne $Command.kind -and [string]$Command.kind -ne [string]$signed.kind) { return $null }
        return $signed
    }
    catch { return $null }
}

Export-ModuleMember -Function Test-AgentSignedCommand
