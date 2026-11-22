#Requires -Version 7.0
# N67: signed release may contain ONLY the reviewed generic first-run
# configuration. Check JSON structure and types without ConvertFrom-Json's
# lossy duplicate-property collapse. Final signed upload uses PowerShell 7.
Set-StrictMode -Version Latest

function Assert-N67ExactJsonProperties {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory=$true)][string[]]$Expected
    )
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw 'Expected JSON object.'
    }
    $allowed=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($name in $Expected) { $null=$allowed.Add($name) }
    foreach ($property in $Object.EnumerateObject()) {
        if (-not $seen.Add($property.Name) -or
            -not $allowed.Contains($property.Name)) {
            throw 'Unknown or duplicate JSON field.'
        }
    }
    if ($seen.Count -ne $allowed.Count) {
        throw 'Missing required JSON field.'
    }
}

function Assert-N67UnprovisionedReleaseConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ConfigPath,
        [Parameter(Mandatory=$true)][string]$FeaturesPath,
        [Parameter(Mandatory=$true)][string]$ExpectedAgentVersion,
        [Parameter(Mandatory=$true)][int]$ExpectedIntervalMinutes
    )
    $configDoc=$null
    $featuresDoc=$null
    try {
        if ($PSVersionTable.PSVersion.Major -lt 7 -or
            $ExpectedAgentVersion -cnotmatch '\A(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,3})\z' -or
            $ExpectedIntervalMinutes -lt 1 -or $ExpectedIntervalMinutes -gt 1440) {
            throw 'Unsupported release configuration context.'
        }
        $configFile=Get-Item -LiteralPath $ConfigPath -Force -ErrorAction Stop
        $featureFile=Get-Item -LiteralPath $FeaturesPath -Force -ErrorAction Stop
        if ($configFile -isnot [IO.FileInfo] -or
            $featureFile -isnot [IO.FileInfo] -or
            ($configFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            ($featureFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $configFile.Length -lt 1 -or $configFile.Length -gt 524288L -or
            $featureFile.Length -lt 1 -or $featureFile.Length -gt 131072L) {
            throw 'Invalid release JSON file.'
        }
        $configDoc=[System.Text.Json.JsonDocument]::Parse([IO.File]::ReadAllText($configFile.FullName))
        $featuresDoc=[System.Text.Json.JsonDocument]::Parse([IO.File]::ReadAllText($featureFile.FullName))
        $config=$configDoc.RootElement
        $featuresRoot=$featuresDoc.RootElement
        Assert-N67ExactJsonProperties -Object $config -Expected @(
            'endpoint','enroll_url','token','bootstrap_token','needs_setup',
            'agent_version','interval_minutes','features','run_script_allowlist'
        )
        Assert-N67ExactJsonProperties -Object $featuresRoot -Expected @('features')
        foreach ($key in @('endpoint','enroll_url','token','bootstrap_token')) {
            $value=$config.GetProperty($key)
            if ($value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $value.GetString() -cne '') {
                throw 'Release configuration contains an endpoint or credential.'
            }
        }
        if ($config.GetProperty('needs_setup').ValueKind -ne [System.Text.Json.JsonValueKind]::True -or
            $config.GetProperty('agent_version').ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $config.GetProperty('agent_version').GetString() -cne $ExpectedAgentVersion -or
            $config.GetProperty('interval_minutes').ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or
            $config.GetProperty('interval_minutes').GetInt32() -ne $ExpectedIntervalMinutes) {
            throw 'Release version, interval or first-run state differs from reviewed source.'
        }
        $allowlist=$config.GetProperty('run_script_allowlist')
        if ($allowlist.ValueKind -ne [System.Text.Json.JsonValueKind]::Array -or
            $allowlist.GetArrayLength() -ne 0) {
            throw 'Unprovisioned installer must not enable arbitrary scripts.'
        }
        $features=$config.GetProperty('features')
        $expectedFeatures=$featuresRoot.GetProperty('features')
        if ($features.ValueKind -ne [System.Text.Json.JsonValueKind]::Array -or
            $expectedFeatures.ValueKind -ne [System.Text.Json.JsonValueKind]::Array -or
            $expectedFeatures.GetArrayLength() -lt 1 -or
            $expectedFeatures.GetArrayLength() -gt 64 -or
            $features.GetArrayLength() -ne $expectedFeatures.GetArrayLength()) {
            throw 'Release feature count differs from approved manifest.'
        }
        $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        $actualItems=New-Object 'System.Collections.Generic.List[System.Text.Json.JsonElement]'
        $expectedItems=New-Object 'System.Collections.Generic.List[System.Text.Json.JsonElement]'
        foreach ($item in $features.EnumerateArray()) { $actualItems.Add($item) }
        foreach ($item in $expectedFeatures.EnumerateArray()) { $expectedItems.Add($item) }
        for ($i=0;$i -lt $actualItems.Count;$i++) {
            $feature=$actualItems[$i]
            $expected=$expectedItems[$i]
            Assert-N67ExactJsonProperties -Object $feature -Expected @(
                'name','script','enabled','requires_elevation'
            )
            Assert-N67ExactJsonProperties -Object $expected -Expected @(
                'name','script','default_enabled','requires_elevation'
            )
            $name=$expected.GetProperty('name').GetString()
            $scriptPath=$expected.GetProperty('script').GetString()
            if ([string]::IsNullOrWhiteSpace($name) -or
                $name -cnotmatch '\A[a-z][a-z0-9_-]{0,63}\z' -or
                -not $seen.Add($name) -or
                [string]::IsNullOrWhiteSpace($scriptPath) -or
                $scriptPath -cnotmatch '\A(?:Scripts|Enterprise/agent/collectors)/[A-Za-z0-9_.-]+\.ps1\z') {
                throw 'Untrusted feature definition in source manifest.'
            }
            if ($feature.GetProperty('name').ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $feature.GetProperty('script').ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $feature.GetProperty('name').GetString() -cne $name -or
                $feature.GetProperty('script').GetString() -cne $scriptPath) {
                throw 'Release feature name or script path differs from reviewed source.'
            }
            foreach ($key in @('enabled','requires_elevation')) {
                $expectedKey=if ($key -ceq 'enabled') { 'default_enabled' } else { 'requires_elevation' }
                $actual=$feature.GetProperty($key)
                $required=$expected.GetProperty($expectedKey)
                if ($actual.ValueKind -notin @([System.Text.Json.JsonValueKind]::True,[System.Text.Json.JsonValueKind]::False) -or
                    $required.ValueKind -notin @([System.Text.Json.JsonValueKind]::True,[System.Text.Json.JsonValueKind]::False) -or
                    $actual.GetBoolean() -ne $required.GetBoolean()) {
                    throw 'Release feature defaults or elevation requirements differ.'
                }
            }
        }
        return $true
    } catch {
        # Never echo JSON data (which may be customer tokens) or local paths.
        throw 'N67 unprovisioned signed-release configuration blocked.'
    } finally {
        if ($null -ne $configDoc) { $configDoc.Dispose() }
        if ($null -ne $featuresDoc) { $featuresDoc.Dispose() }
    }
}

Export-ModuleMember -Function Assert-N67UnprovisionedReleaseConfig
