#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$Enterprise = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvFile = Join-Path $Enterprise '.env'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop must be installed and running.' }
function New-StrongSecret {
  $bytes = New-Object byte[] 36
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
  $lines = @(
    "MYSQL_ROOT_PASSWORD=$(New-StrongSecret)",
    'MYSQL_DATABASE=it_toolkit',
    'MYSQL_USER=itk_user',
    "MYSQL_PASSWORD=$(New-StrongSecret)",
    'SERVER_HOST=localhost',
    'CADDY_HOST=:80'
  )
  $content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
  [IO.File]::WriteAllText($EnvFile, $content, (New-Object Text.UTF8Encoding($false)))
  Write-Host 'Generated Enterprise/.env with unique credentials.'
} else { Write-Host 'Existing Enterprise/.env and database preserved.' }
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls $EnvFile '/inheritance:r' '/grant:r' "*$($currentSid):(F)" '*S-1-5-32-544:(F)' '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to protect Enterprise/.env with NTFS ACLs.' }
$ComposeFile = Join-Path $Enterprise 'docker-compose.yml'
& docker compose --env-file $EnvFile -f $ComposeFile up -d --build db api
if ($LASTEXITCODE -ne 0) { throw 'Docker bootstrap failed; inspect Compose logs.' }
Write-Host 'Open locally only: http://localhost:3000/'
Write-Host 'Retrieve the host setup code:'
Write-Host ('docker compose --env-file "' + $EnvFile + '" -f "' + $ComposeFile + '" exec -T api cat /data/first-run-setup-code')
Write-Warning 'Never expose the initial HTTP bootstrap page publicly.'
