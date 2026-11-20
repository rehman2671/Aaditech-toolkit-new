#Requires -Version 5.1
# N58: authenticate SAME independently reviewer-signed source approval when
# a separate GitHub Release workflow downloads the signed CI artifact.
# No private keys or network requests. Never trust a SHA receipt alone.
Set-StrictMode -Version Latest

function Assert-N58SourceApproval {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ArtifactDir,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedSourceSha,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedVersion,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedRevision,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedReleaseTag,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedPublisherThumbprint,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedSqliteArchiveSha256,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedSqliteExeSha256,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ManifestBase64,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$SignatureBase64,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ReviewerDerBase64,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ApprovedReviewerSha256
    )
    $stream=$null
    try {
        if ($env:OS -cne 'Windows_NT' -or
            $ExpectedSourceSha -cnotmatch '\A[0-9a-f]{40}\z' -or
            $ExpectedRevision -cnotmatch '\A(?:[1-9]|[1-9][0-9]{1,2})\z' -or
            $ExpectedVersion -cnotmatch '\A(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,3})\z' -or
            $ExpectedReleaseTag -cne ('agent-v'+$ExpectedVersion+'-r'+$ExpectedRevision)) {
            throw 'Release identifier differs from reviewed source.'
        }
        $root=[IO.Path]::GetFullPath($ArtifactDir)
        $expectedNames=@(
            'IT-Toolkit-Agent.exe',
            ('IT-Toolkit-Agent-'+$ExpectedVersion+'.msi'),
            'SHA256SUMS.txt',
            'agent-config.json',
            'RELEASE-APPROVAL-SHA256.txt'
        )
        $files=@(Get-ChildItem -LiteralPath $root -Force -ErrorAction Stop)
        if ($files.Count -ne $expectedNames.Count) {
            throw 'Unexpected signed source artifact contents.'
        }
        foreach ($file in $files) {
            if ($file -isnot [IO.FileInfo] -or
                ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                $expectedNames -cnotcontains $file.Name) {
                throw 'Untrusted source artifact entry.'
            }
        }
        Import-Module -Name (Join-Path $PSScriptRoot 'ReleaseArtifactManifest.psm1') -Force -ErrorAction Stop
        $null=Assert-N55SignedPublicationManifest -OutputDirectory $root -ExpectedAgentVersion $ExpectedVersion
        $configPath=Join-Path $root 'agent-config.json'
        $configFile=Get-Item -LiteralPath $configPath -Force -ErrorAction Stop
        if ($configFile.Length -lt 2 -or $configFile.Length -gt 16384) {
            throw 'Unbounded setup template.'
        }
        $cfg=Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop |
            ConvertFrom-Json -ErrorAction Stop
        if ($cfg.needs_setup -ne $true -or
            -not [string]::IsNullOrEmpty([string]$cfg.endpoint) -or
            -not [string]::IsNullOrEmpty([string]$cfg.enroll_url) -or
            -not [string]::IsNullOrEmpty([string]$cfg.token) -or
            -not [string]::IsNullOrEmpty([string]$cfg.bootstrap_token)) {
            throw 'Source artifact contains provisioned setup.'
        }
        $receipt=Join-Path $root 'RELEASE-APPROVAL-SHA256.txt'
        $stream=[IO.File]::Open($receipt,[IO.FileMode]::Open,
            [IO.FileAccess]::Read,[IO.FileShare]::Read)
        if ($stream.Length -ne 65) {
            throw 'Source release approval receipt must be exact digest plus LF.'
        }
        $bytes=[byte[]]::new(65)
        $offset=0
        while ($offset -lt $bytes.Length) {
            $read=$stream.Read($bytes,$offset,$bytes.Length-$offset)
            if ($read -le 0) { throw 'Source approval receipt truncated.' }
            $offset += $read
        }
        if ($bytes[64] -ne 10) { throw 'Noncanonical approval receipt terminator.' }
        foreach ($i in 0..63) {
            $v=$bytes[$i]
            if (-not (($v -ge 48 -and $v -le 57) -or
                       ($v -ge 65 -and $v -le 70))) {
                throw 'Untrusted approval identity format.'
            }
        }
        $receiptHash=[Text.Encoding]::ASCII.GetString($bytes,0,64)
        Import-Module -Name (Join-Path $PSScriptRoot 'ReviewedReleaseApproval.psm1') -Force -ErrorAction Stop
        $params=@{
            ManifestBase64=$ManifestBase64
            SignatureBase64=$SignatureBase64
            ReviewerDerBase64=$ReviewerDerBase64
            ApprovedReviewerSha256=$ApprovedReviewerSha256
            ExpectedGitSha=$ExpectedSourceSha
            ExpectedAgentVersion=$ExpectedVersion
            ExpectedMsiRevision=$ExpectedRevision
            ExpectedPublisherThumbprint=$ExpectedPublisherThumbprint
            ExpectedSqliteArchiveSha256=$ExpectedSqliteArchiveSha256
            ExpectedSqliteExeSha256=$ExpectedSqliteExeSha256
            ExpectedManifestSha256=$receiptHash
        }
        $null=Assert-N56ReviewedRelease @params
        return $true
    } catch {
        # Never print signer hashes, approval values, local paths or cert.
        throw 'N58 signed release publication approval blocked.'
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

Export-ModuleMember -Function Assert-N58SourceApproval
