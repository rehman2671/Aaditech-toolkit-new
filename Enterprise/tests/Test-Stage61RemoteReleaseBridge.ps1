#Requires -Version 5.1
# Phase N61: real remote bridge script invoked with a synthetic in-process
# gh API shim. NO GitHub traffic, customer services or production signing.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -cne 'Windows_NT') { throw 'N61 remote release bridge test requires Windows.' }

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$bridge = Join-Path $root 'Enterprise\agent\build\Assert-RemoteReleaseAssets.ps1'
$versionFile = Join-Path $root 'Enterprise\agent\agent-version.json'
$metadata = Get-Content -LiteralPath $versionFile -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
$version = [string]$metadata.agent_version
$revision = [string]$metadata.msi_revision
$tag = 'agent-v'+$version+'-r'+$revision
$sourceSha='a'*40
$releaseId=[long]739183
$repoName='n61-offline-testing/synthetic-github-api'
$refsEndpoint='repos/'+$repoName+'/git/matching-refs/tags/'+$tag
$releaseEndpoint='repos/'+$repoName+'/releases/'+$releaseId
$dir=Join-Path ([IO.Path]::GetTempPath()) ('n61-gh-bridge-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($dir)
$oldEnvironment=@{}
$keys=@('GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_REF',
        'GITHUB_REPOSITORY','SOURCE_SHA','APPROVED_MSI_SHA256',
        'GH_TOKEN','RELEASE_TAG')
foreach ($name in $keys) {
    $oldEnvironment[$name]=[Environment]::GetEnvironmentVariable($name)
}
$script:refsJson='[]'
$script:releaseJson='{}'
$script:failApi=''
$script:calls=New-Object 'System.Collections.Generic.List[string]'

function gh {
    [CmdletBinding()]
    param(
        [Parameter(Position=0)][string]$Command,
        [Parameter(Position=1)][string]$Endpoint
    )
    if ($Command -cne 'api' -or
        ($Endpoint -cne $refsEndpoint -and $Endpoint -cne $releaseEndpoint)) {
        throw 'N61 test blocked an unexpected command or network endpoint.'
    }
    $script:calls.Add($Endpoint)
    if ($script:failApi -ceq $Endpoint) {
        $global:LASTEXITCODE=1
        return
    }
    $global:LASTEXITCODE=0
    if ($Endpoint -ceq $refsEndpoint) {
        Write-Output $script:refsJson
    } else {
        Write-Output $script:releaseJson
    }
}

function Assert-N61RemoteDenied {
    param([scriptblock]$Action,[string]$Case)
    $blocked=$false
    try {
        $null=& $Action
    } catch {
        $blocked=$true
        if ($_.Exception.Message -cne 'N60 remote release publication integrity blocked.') {
            throw ('N61 error contained unapproved remote response data: '+$Case)
        }
    }
    if (-not $blocked) { throw ('N61 remote bridge allowed unsafe case: '+$Case) }
}

try {
    [Environment]::SetEnvironmentVariable('GITHUB_ACTIONS','true')
    [Environment]::SetEnvironmentVariable('GITHUB_EVENT_NAME','workflow_dispatch')
    [Environment]::SetEnvironmentVariable('GITHUB_REF','refs/heads/main')
    [Environment]::SetEnvironmentVariable('GITHUB_REPOSITORY',$repoName)
    [Environment]::SetEnvironmentVariable('SOURCE_SHA',$sourceSha)
    [Environment]::SetEnvironmentVariable('GH_TOKEN','N61-FAKE-TOKEN-DO-NOT-AUTHENTICATE')
    [Environment]::SetEnvironmentVariable('RELEASE_TAG',$tag)

    $exeName='IT-Toolkit-Agent.exe'
    $msiName='IT-Toolkit-Agent-'+$version+'.msi'
    $sumName='SHA256SUMS.txt'
    [IO.File]::WriteAllBytes((Join-Path $dir $exeName),
        [Text.Encoding]::ASCII.GetBytes('N61 synthetic unsigned EXE not for release'))
    [IO.File]::WriteAllBytes((Join-Path $dir $msiName),
        [Text.Encoding]::ASCII.GetBytes('N61 synthetic unsigned MSI not for release'))
    $exeHash=(Get-FileHash -LiteralPath (Join-Path $dir $exeName) -Algorithm SHA256).Hash.ToLowerInvariant()
    $msiHash=(Get-FileHash -LiteralPath (Join-Path $dir $msiName) -Algorithm SHA256).Hash.ToLowerInvariant()
    $lf=[string][char]10
    $sums=$exeHash+'  '+$exeName+$lf+$msiHash+'  '+$msiName+$lf
    [IO.File]::WriteAllBytes((Join-Path $dir $sumName),[Text.Encoding]::ASCII.GetBytes($sums))
    [Environment]::SetEnvironmentVariable('APPROVED_MSI_SHA256',$msiHash.ToUpperInvariant())

    $assets=@()
    $fileNames=@($exeName,$msiName,$sumName)
    for ($index=0;$index -lt $fileNames.Count;$index++) {
        $file=Get-Item -LiteralPath (Join-Path $dir $fileNames[$index])
        $assets+=@{
            id=(500+$index)
            name=$fileNames[$index]
            size=[long]$file.Length
            state='uploaded'
            digest='sha256:'+(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $draft=@{
        id=$releaseId
        tag_name=$tag
        target_commitish=$sourceSha
        prerelease=$false
        draft=$true
        published_at=$null
        assets=$assets
    }
    $script:releaseJson=ConvertTo-Json -InputObject $draft -Depth 15 -Compress

    # Tests the ACTUAL production bridge, not merely its imported helpers.
    $script:calls.Clear()
    & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequireDraft
    if ($script:calls.Count -ne 2 -or
        $script:calls[0] -cne $refsEndpoint -or
        $script:calls[1] -cne $releaseEndpoint) {
        throw 'N61 bridge did not query exclusively the expected two read-only API endpoints.'
    }
    Assert-N61RemoteDenied -Case 'draft must not pass published state' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }

    $script:refsJson='[{"ref":"refs/tags/'+$tag+'","object":{"type":"commit","sha":"'+$sourceSha+'"}}]'
    $public=$draft.Clone()
    $public.draft=$false
    $public.published_at='2026-11-21T00:00:00Z'
    $script:releaseJson=ConvertTo-Json -InputObject $public -Depth 15 -Compress
    $script:calls.Clear()
    & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    if ($script:calls.Count -ne 2 -or
        $script:calls[0] -cne $refsEndpoint -or
        $script:calls[1] -cne $releaseEndpoint) {
        throw 'N61 public bridge did not query exact read-only API endpoints.'
    }

    Assert-N61RemoteDenied -Case 'public ref exists while requested draft' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequireDraft
    }
    $script:refsJson='[]'
    Assert-N61RemoteDenied -Case 'published record lacks actual Git tag' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }
    $script:refsJson='[{"ref":"refs/tags/'+$tag+'","object":{"type":"commit","sha":"'+('b'*40)+'"}}]'
    Assert-N61RemoteDenied -Case 'published tag points to unauthorized source' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }
    $script:refsJson='[{"ref":"refs/tags/'+$tag+'","object":{"type":"commit","sha":"'+$sourceSha+'"}}]'
    $wrong=$public.Clone()
    $wrong.id=[long]($releaseId+1)
    $script:releaseJson=ConvertTo-Json -InputObject $wrong -Depth 15 -Compress
    Assert-N61RemoteDenied -Case 'API response different immutable release database ID' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }
    $corrupt=$public.Clone()
    $corrupt.assets=@($assets | ForEach-Object { $_.Clone() })
    $corrupt.assets[1].digest='sha256:'+('0'*64)
    $script:releaseJson=ConvertTo-Json -InputObject $corrupt -Depth 15 -Compress
    Assert-N61RemoteDenied -Case 'hosted release MSI digest mutation' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }
    $script:releaseJson=ConvertTo-Json -InputObject $public -Depth 15 -Compress
    $script:failApi=$releaseEndpoint
    Assert-N61RemoteDenied -Case 'GitHub API returned error instead of release ID response' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }
    $script:failApi=''
    $script:refsJson='not-json'
    Assert-N61RemoteDenied -Case 'malformed remote tag refs JSON' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }
    $script:refsJson='[{"ref":"refs/tags/'+$tag+'","object":{"type":"commit","sha":"'+$sourceSha+'"}}]'
    [Environment]::SetEnvironmentVariable('GITHUB_EVENT_NAME','push')
    $script:calls.Clear()
    Assert-N61RemoteDenied -Case 'automatic CI cannot access manually protected publisher bridge' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }
    if ($script:calls.Count -ne 0) { throw 'N61 auto-push guard consulted GitHub before refusing.' }
    [Environment]::SetEnvironmentVariable('GITHUB_EVENT_NAME','workflow_dispatch')
    [Environment]::SetEnvironmentVariable('SOURCE_SHA','b'*40)
    $script:calls.Clear()
    Assert-N61RemoteDenied -Case 'different approved source cannot pass tagged release' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }
    [Environment]::SetEnvironmentVariable('SOURCE_SHA',$sourceSha)
    [Environment]::SetEnvironmentVariable('GH_TOKEN','')
    Assert-N61RemoteDenied -Case 'missing GitHub authentication token' -Action {
        & $bridge -ArtifactDir $dir -ReleaseId $releaseId -RequirePublished
    }
    Write-Host 'N61 PASS: real production bridge with offline gh shim, draft without ref, exact published ID and source tag, three hosted assets, API failures, signer context and redacted denial.'
} finally {
    foreach ($key in $keys) {
        [Environment]::SetEnvironmentVariable($key,$oldEnvironment[$key])
    }
    Remove-Item -LiteralPath Function:\gh -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
