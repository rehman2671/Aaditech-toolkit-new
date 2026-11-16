# Windows-only verification before publishing GitHub Release installer files.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ArtifactDir,
      [Parameter(Mandatory=$true)][string]$ApprovedThumbprint)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ArtifactDir).Path
$pin = ($ApprovedThumbprint -replace '\s','').ToUpperInvariant()
if ($pin -cnotmatch '^[A-F0-9]{40}$') { throw 'Approved publisher thumbprint missing.' }
$exe = Join-Path $root 'IT-Toolkit-Agent.exe'
$msis = @(Get-ChildItem -LiteralPath $root -File -Filter 'IT-Toolkit-Agent-*.msi')
$manifest = Join-Path $root 'SHA256SUMS.txt'
$configPath = Join-Path $root 'agent-config.json'
if ($msis.Count -ne 1) { throw 'Exactly one signed MSI required.' }
foreach ($path in @($exe,$manifest,$configPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing release asset: $path" }
}
$cfg = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not $cfg.needs_setup -or $cfg.endpoint -or $cfg.enroll_url -or $cfg.token -or $cfg.bootstrap_token) {
  throw 'Release must contain only unprovisioned configuration.'
}
$entries = @{}
foreach ($line in @(Get-Content $manifest)) {
  if ($line -cnotmatch '^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$') { throw 'Invalid SHA-256 manifest format.' }
  $entries[$Matches[2]] = $Matches[1]
}
if ($entries.Count -ne 2) { throw 'Exactly two signed binaries are expected in SHA-256 manifest.' }
$sdk = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits\10\bin'
$signtool = Get-ChildItem $sdk -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\d+\.\d+\.\d+\.\d+\\x64' } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'Windows SDK signtool is required.' }
foreach ($item in @($exe,$msis[0].FullName)) {
  $name = [IO.Path]::GetFileName($item)
  $hash = (Get-FileHash -LiteralPath $item -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $entries.ContainsKey($name) -or $entries[$name] -cne $hash) {
    throw "Release manifest mismatch: $name"
  }
  & $signtool.FullName verify /pa /v $item
  if ($LASTEXITCODE -ne 0) { throw "Untrusted Authenticode chain: $name" }
  $signature = Get-AuthenticodeSignature -LiteralPath $item
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
      $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $pin -or
      -not $signature.TimeStamperCertificate) {
    throw "Wrong publisher, missing trust or missing timestamp: $name"
  }
}
$tempDir = Join-Path $env:RUNNER_TEMP ('itk-publish-' + [Guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $arguments = '/a "' + $msis[0].FullName + '" /qn TARGETDIR="' + $tempDir + '"'
  $proc = Start-Process -FilePath msiexec.exe -ArgumentList $arguments -PassThru -Wait
  if ($proc.ExitCode -ne 0) { throw 'MSI administrative extraction failed.' }
  $inside = Get-ChildItem -LiteralPath $tempDir -Recurse -File -Filter 'IT-Toolkit-Agent.exe' |
    Select-Object -First 1
  if (-not $inside -or (Get-FileHash -LiteralPath $inside.FullName -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash) {
    throw 'MSI embedded executable does not match verified signed EXE.'
  }
} finally {
  if (Test-Path $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
Write-Host '[PASS] Publisher, timestamp, hashes, MSI payload and unprovisioned setup verified.'
