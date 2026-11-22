#Requires -Version 7.0
# N67: synthetic offline release config only. No customer token, signing
# material, real MSI artifact or network/production environment required.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module -Name (Join-Path $repo 'Enterprise\agent\build\ReleaseConfigAdmission.psm1') -Force -ErrorAction Stop
$releaseScript=Get-Content -LiteralPath (Join-Path $repo 'Enterprise\agent\build\Verify-SignedPublication.ps1') -Raw
$workflow=Get-Content -LiteralPath (Join-Path $repo '.github\workflows\ci.yml') -Raw
$work=Join-Path ([IO.Path]::GetTempPath()) ('n67-offline-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($work)
$cfgPath=Join-Path $work 'agent-config.json'
$featuresPath=Join-Path $work 'features.json'
$version='1.1.2'
$interval=30

function Require-N67Denied {
    param([string]$Case,[string]$Raw)
    [IO.File]::WriteAllText($cfgPath,$Raw,[Text.UTF8Encoding]::new($false))
    $denied=$false
    try {
        $null=Assert-N67UnprovisionedReleaseConfig -ConfigPath $cfgPath -FeaturesPath $featuresPath -ExpectedAgentVersion $version -ExpectedIntervalMinutes $interval
    } catch {
        $denied=$true
        if ($_.Exception.Message -cne 'N67 unprovisioned signed-release configuration blocked.') {
            throw ('N67 leaked a release configuration on rejection: '+$Case)
        }
    }
    if (-not $denied) { throw ('N67 wrongly accepted: '+$Case) }
}
function Render-N67 {
    param($Value)
    return ($Value | ConvertTo-Json -Depth 9)
}
try {
    Copy-Item -LiteralPath (Join-Path $repo 'Enterprise\agent\features.json') -Destination $featuresPath
    $manifest=(Get-Content -LiteralPath $featuresPath -Raw | ConvertFrom-Json).features
    $features=@($manifest | ForEach-Object {
        [ordered]@{name=$_.name;script=$_.script;enabled=[bool]$_.default_enabled;requires_elevation=[bool]$_.requires_elevation}
    })
    $cfg=[ordered]@{
        endpoint=''
        enroll_url=''
        token=''
        bootstrap_token=''
        needs_setup=$true
        agent_version=$version
        interval_minutes=$interval
        features=$features
        run_script_allowlist=@()
    }
    $good=Render-N67 $cfg
    [IO.File]::WriteAllText($cfgPath,$good,[Text.UTF8Encoding]::new($false))
    if ((Assert-N67UnprovisionedReleaseConfig -ConfigPath $cfgPath -FeaturesPath $featuresPath -ExpectedAgentVersion $version -ExpectedIntervalMinutes $interval) -ne $true) {
        throw 'Valid generic first-run release config rejected.'
    }

    foreach($case in @(
        @{name='server address';key='endpoint';value='https://tenant.example.invalid'},
        @{name='enrollment URL';key='enroll_url';value='https://tenant.example.invalid/enroll'},
        @{name='private token';key='token';value='sensitive-no-real-token'},
        @{name='bootstrap credential';key='bootstrap_token';value='sensitive-no-real-token'},
        @{name='wrong agent version';key='agent_version';value='9.9.9'},
        @{name='wrong polling interval';key='interval_minutes';value=31},
        @{name='numeric string instead of number';key='interval_minutes';value='30'},
        @{name='wrong boolean';key='needs_setup';value=$false},
        @{name='boolean string instead of boolean';key='needs_setup';value='true'},
        @{name='arbitrary script allowlist';key='run_script_allowlist';value=@('Scripts/Unknown.ps1')}
    )) {
        $bad=$good | ConvertFrom-Json -Depth 12
        $bad.($case.key)=$case.value
        Require-N67Denied -Case $case.name -Raw (Render-N67 $bad)
    }

    $bad=$good | ConvertFrom-Json -Depth 12
    $bad | Add-Member -NotePropertyName 'client_secret' -NotePropertyValue 'sensitive-no-real-token'
    Require-N67Denied -Case 'unexpected credential field' -Raw (Render-N67 $bad)
    $bad=$good | ConvertFrom-Json -Depth 12
    $bad.features[0].script='Scripts/Injected.ps1'
    Require-N67Denied -Case 'changed feature script path' -Raw (Render-N67 $bad)
    $bad=$good | ConvertFrom-Json -Depth 12
    $bad.features[0].enabled=$false
    Require-N67Denied -Case 'changed enabled default' -Raw (Render-N67 $bad)
    $bad=$good | ConvertFrom-Json -Depth 12
    $bad.features[0].requires_elevation=$true
    Require-N67Denied -Case 'changed elevation requirement' -Raw (Render-N67 $bad)
    $bad=$good | ConvertFrom-Json -Depth 12
    $bad.features[0] | Add-Member -NotePropertyName 'token' -NotePropertyValue 'sensitive-no-real-token'
    Require-N67Denied -Case 'secret inside nested feature' -Raw (Render-N67 $bad)
    $bad=$good | ConvertFrom-Json -Depth 12
    $bad.features=@($bad.features | Select-Object -Skip 1)
    Require-N67Denied -Case 'feature removed' -Raw (Render-N67 $bad)
    $bad=$good | ConvertFrom-Json -Depth 12
    $bad.features=@($bad.features | Sort-Object name)
    Require-N67Denied -Case 'modified feature order' -Raw (Render-N67 $bad)
    $duplicateRoot=[regex]::Replace($good,'("token"\s*:\s*"")','"token":"sensitive-no-real-token",$1',1)
    if ($duplicateRoot -ceq $good) { throw 'Synthetic duplicate root case not generated.' }
    Require-N67Denied -Case 'duplicate credential JSON property' -Raw $duplicateRoot
    $duplicateFeature=[regex]::Replace($good,'("enabled"\s*:\s*(?:true|false))','$1,"enabled":true',1)
    if ($duplicateFeature -ceq $good) { throw 'Synthetic duplicate feature case not generated.' }
    Require-N67Denied -Case 'duplicate feature JSON property' -Raw $duplicateFeature
    Require-N67Denied -Case 'malformed JSON' -Raw '{"token":'
    Require-N67Denied -Case 'root array instead of object' -Raw '[]'
    Require-N67Denied -Case 'oversized JSON release payload' -Raw (' '*524289)

    # Final post-Authenticode release gate must validate EVERY config,
    # including the external upload config and each MSI-extracted agent.json.
    $candidatePos=$releaseScript.IndexOf('foreach ($configPath in $configs)',[StringComparison]::Ordinal)
    $guardPos=$releaseScript.IndexOf('Assert-N67UnprovisionedReleaseConfig',[StringComparison]::Ordinal)
    $finalPos=$releaseScript.IndexOf("PUBLICATION_VERIFIED=true",[StringComparison]::Ordinal)
    if ($candidatePos -lt 0 -or $guardPos -le $candidatePos -or
        $finalPos -le $guardPos -or
        $releaseScript -cnotmatch '\$configs = @\(\(Join-Path \$out ''agent-config.json''\)\)' -or
        $releaseScript -cnotmatch 'Get-ChildItem -LiteralPath \$extract -Recurse -File -Filter ''agent.json''' -or
        [regex]::Matches($workflow,'Test-Stage67ReleaseConfigAdmission\.ps1').Count -ne 1) {
        throw 'N67 signed release config validation or PS7 regression CI gate is missing.'
    }
    Write-Host 'N67 PASS: generic release JSON strict schema, duplicate keys, script allowlist, tenant credentials, feature identities and pre-publication ordering.'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
