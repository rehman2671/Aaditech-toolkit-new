# Stage 9: negative-path release signing regression. No real certificate used.
$ErrorActionPreference = 'Stop'
$signer = Join-Path $PSScriptRoot '..\agent\build\Release-Sign.ps1'
if (-not (Test-Path -LiteralPath $signer)) { throw 'Signing script missing.' }
$vars = @('GITHUB_ENV', 'RELEASE_SIGNING_ENABLED', 'PUBLISH_SIGNED',
          'CODESIGN_PFX_B64', 'CODESIGN_PFX_PASSWORD', 'CODESIGN_APPROVED_THUMBPRINT')
$prior = @{}
foreach ($name in $vars) { $prior[$name] = [Environment]::GetEnvironmentVariable($name) }
$file = Join-Path $env:RUNNER_TEMP ('itk-negative-sign-' + [Guid]::NewGuid().ToString('N') + '.txt')
try {
    $env:GITHUB_ENV = $file
    # A diagnostic/unsigned build is permitted in CI but NEVER published.
    $env:CODESIGN_PFX_B64 = ''
    $env:CODESIGN_PFX_PASSWORD = ''
    $env:CODESIGN_APPROVED_THUMBPRINT = ''
    $env:RELEASE_SIGNING_ENABLED = ''
    & $signer -Stage PrePackage
    $lines = @(Get-Content -LiteralPath $file)
    if ('RELEASE_SIGNING_ENABLED=false' -notin $lines -or 'PUBLISH_SIGNED=false' -notin $lines) {
        throw 'Missing certificate did not disable publication.'
    }
    $env:RELEASE_SIGNING_ENABLED = 'false'
    & $signer -Stage Finalize
    $lines = @(Get-Content -LiteralPath $file)
    if ('PUBLISH_SIGNED=false' -notin $lines) { throw 'Unsigned finalize did not disable publication.' }
    Write-Host '[PASS] Without an approved certificate, release signing disables artifact publication.'

    # Partial secrets and invalid fingerprints must not silently pass.
    $env:CODESIGN_PFX_B64 = 'intentional-invalid-fixture'
    $env:CODESIGN_PFX_PASSWORD = 'not-a-real-password'
    $env:CODESIGN_APPROVED_THUMBPRINT = ''
    $env:RELEASE_SIGNING_ENABLED = ''
    $blocked = $false
    try { & $signer -Stage PrePackage }
    catch { $blocked = $_.Exception.Message -match 'Incomplete release signing credentials' }
    if (-not $blocked) { throw 'Incomplete signing secrets were not rejected.' }
    $env:CODESIGN_APPROVED_THUMBPRINT = 'not-a-sha1-thumbprint'
    $blocked = $false
    try { & $signer -Stage PrePackage }
    catch { $blocked = $_.Exception.Message -match 'thumbprint' }
    if (-not $blocked) { throw 'Malformed approved publisher fingerprint was not rejected.' }
    Write-Host '[PASS] Partial signing configuration and invalid publisher pin are rejected.'
} finally {
    foreach ($name in $vars) {
        [Environment]::SetEnvironmentVariable($name, $prior[$name])
    }
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}
