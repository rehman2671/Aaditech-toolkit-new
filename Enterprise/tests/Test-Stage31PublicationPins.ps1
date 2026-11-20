# Stage N31 signing/publication negative-path validation.
# No real certificate, source artifact, GitHub release or signing token required.
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$verify = Join-Path $root 'Enterprise\agent\build\Verify-ReleaseArtifact.ps1'
$workflow = Get-Content -LiteralPath (Join-Path $root '.github\workflows\publish-signed-installer.yml') -Raw
foreach ($required in @('approved_source_sha:', 'approved_msi_sha256:',
    'APPROVED_SOURCE_SHA', 'source.head_sha -cne', 'ApprovedMsiSha256')) {
    if (-not $workflow.Contains($required)) { throw "Missing independently pinned release workflow field: $required" }
}
$tmp = Join-Path $env:RUNNER_TEMP ('n31-publish-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    $exe = Join-Path $tmp 'IT-Toolkit-Agent.exe'
    $msi = Join-Path $tmp 'IT-Toolkit-Agent-1.1.2.msi'
    [IO.File]::WriteAllText($exe, 'unsigned fixture, never publish')
    [IO.File]::WriteAllText($msi, 'synthetic unsigned MSI, never publish')
    @{needs_setup=$true;endpoint='';token='';bootstrap_token='';enroll_url=''} |
        ConvertTo-Json | Set-Content (Join-Path $tmp 'agent-config.json')
    $sumFile = Join-Path $tmp 'SHA256SUMS.txt'
    $entries = @(@($exe,$msi) | ForEach-Object {
        $h = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
        "$h  $([IO.Path]::GetFileName($_))"
    })
    $entries | Set-Content -LiteralPath $sumFile -Encoding ascii
    $blocked = $false
    try {
        & $verify -ArtifactDir $tmp -ApprovedThumbprint ('A' * 40) -ApprovedMsiSha256 'not-a-hash' -ApprovedSqliteExeSha256 ('C' * 64)
    } catch { $blocked = $_.Exception.Message -match 'Independent approved MSI SHA256' }
    if (-not $blocked) { throw 'Malformed independent MSI SHA256 was not denied.' }
    $blocked = $false
    try {
        & $verify -ArtifactDir $tmp -ApprovedThumbprint ('A' * 40) -ApprovedMsiSha256 ('B' * 64) -ApprovedSqliteExeSha256 ('C' * 64)
    } catch { $blocked = $_.Exception.Message -match 'independently approved SHA256' }
    if (-not $blocked) { throw 'Correct manifest but mismatched external MSI hash was accepted.' }
    Write-Host 'N31 PASS: malformed/mismatched operator pin cannot publish an otherwise consistent unsigned fixture.'
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
