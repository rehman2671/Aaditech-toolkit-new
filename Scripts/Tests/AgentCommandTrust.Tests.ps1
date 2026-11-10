# PowerShell v5.1 & 7 regressions for the actual endpoint HMAC verifier.
BeforeAll {
  Import-Module (Join-Path $PSScriptRoot '..\Modules\AgentCommandTrust.psm1') -Force
  function New-SignedCommand {
    param([long]$IssuedAtMs,[string]$TargetDevice='agent-id-a',[string]$TargetHost='WIN-A')
    $content = [ordered]@{
      protocol_version=1;id='command-1';device_id=$TargetDevice
      hostname=$TargetHost;kind='reboot';payload=[ordered]@{delay_seconds=30}
      issued_at=$IssuedAtMs;expires_at=($IssuedAtMs+300000)
    } | ConvertTo-Json -Depth 8 -Compress
    $key='a'*64
    $bytes=[System.Text.Encoding]::UTF8.GetBytes($key)
    $hmac=New-Object System.Security.Cryptography.HMACSHA256 (,[byte[]]$bytes)
    try {$sig=([BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($content)))).Replace('-','').ToLowerInvariant()}
    finally {$hmac.Dispose()}
    return [PSCustomObject]@{id='command-1';kind='reboot';signed_content=$content;signature=$sig}
  }
}

Describe 'Agent command HMAC authentication' {
  It 'executes only a timely authentic same-device envelope' {
    $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $command=New-SignedCommand -IssuedAtMs $now
    $verified=Test-AgentSignedCommand -Command $command -CommandKey ('a'*64) -DeviceId 'agent-id-a' -Hostname 'win-a' -NowMs $now
    $verified.kind | Should -Be 'reboot'
    $verified.payload.delay_seconds | Should -Be 30
  }
  It 'rejects changed signed content and forged signatures' {
    $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $command=New-SignedCommand -IssuedAtMs $now
    $command.signed_content=$command.signed_content.Replace('reboot','run-script')
    (Test-AgentSignedCommand -Command $command -CommandKey ('a'*64) -DeviceId 'agent-id-a' -Hostname 'WIN-A' -NowMs $now) | Should -BeNullOrEmpty
    $command=New-SignedCommand -IssuedAtMs $now
    $command.signature='f'*64
    (Test-AgentSignedCommand -Command $command -CommandKey ('a'*64) -DeviceId 'agent-id-a' -Hostname 'WIN-A' -NowMs $now) | Should -BeNullOrEmpty
  }
  It 'rejects expired and future-dated commands' {
    $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $expired=New-SignedCommand -IssuedAtMs ($now-400000)
    (Test-AgentSignedCommand -Command $expired -CommandKey ('a'*64) -DeviceId 'agent-id-a' -Hostname 'WIN-A' -NowMs $now) | Should -BeNullOrEmpty
    $future=New-SignedCommand -IssuedAtMs ($now+120000)
    (Test-AgentSignedCommand -Command $future -CommandKey ('a'*64) -DeviceId 'agent-id-a' -Hostname 'WIN-A' -NowMs $now) | Should -BeNullOrEmpty
  }
  It 'rejects cross-device replay and absent keys' {
    $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $command=New-SignedCommand -IssuedAtMs $now
    (Test-AgentSignedCommand -Command $command -CommandKey ('a'*64) -DeviceId 'agent-id-b' -Hostname 'WIN-A' -NowMs $now) | Should -BeNullOrEmpty
    (Test-AgentSignedCommand -Command $command -CommandKey '' -DeviceId 'agent-id-a' -Hostname 'WIN-A' -NowMs $now) | Should -BeNullOrEmpty
  }
}
