# Stage N31 negative customer-machine acceptance regression, no network.
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'Test-CustomerWindowsAcceptance.ps1'
$root = Join-Path $env:RUNNER_TEMP ('n31-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
  $config = Join-Path $root 'agent.json'
  $report = Join-Path $root 'result.json'
  $secret = 'N31-SYNTHETIC-SECRET-MUST-NOT-LEAK'
  @{endpoint='https://test.invalid/api/v1/ingest/telemetry';token=$secret;needs_setup=$true} |
    ConvertTo-Json | Set-Content -LiteralPath $config
  $args = @('-NoProfile','-File',$scriptPath,'-ReportPath',$report,
    '-InstallRoot',$root,'-ConfigPath',$config,
    '-QueueDb',(Join-Path $root 'queue.sqlite3'))
  & pwsh @args | Out-Null
  if ($LASTEXITCODE -ne 1) { throw 'Unprovisioned device was accepted.' }
  $raw = Get-Content -LiteralPath $report -Raw
  $result = $raw | ConvertFrom-Json
  if ($result.decision -cne 'BLOCKED' -or $result.certified_for_production -ne $false -or
      $result.blockers -lt 3) { throw 'Unconfigured customer machine reported ready.' }
  if ($raw.Contains($secret) -or $raw.Contains('test.invalid')) {
    throw 'Acceptance report leaked private configuration.'
  }
  $offline = @($result.checks | Where-Object { $_.id -eq 'public_https' })
  if ($offline.Count -ne 1 -or $offline[0].state -cne 'PENDING') {
    throw 'Unapproved network probe or incorrect offline status.'
  }
  Write-Host 'N31 PASS: Windows customer acceptance blocks missing setup, redacts secrets, avoids network.'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
