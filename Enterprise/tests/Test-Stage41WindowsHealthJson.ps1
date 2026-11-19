#Requires -Version 5.1
# N41: fully offline, synthetic health JSON fixtures only.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$policy = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\deploy\ValidateWindowsHealthJson.psm1'))
$rawPolicy = [IO.File]::ReadAllText($policy)
foreach ($untrustedTransport in @('Invoke-RestMethod','Invoke-WebRequest','WebRequest','curl.exe','GetHostAddresses','TcpClient')) {
    if ($rawPolicy.IndexOf($untrustedTransport,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'N41 policy must never contain a live network transport.'
    }
}
Import-Module -Name $policy -Force -ErrorAction Stop
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)

function Assert-Accepted {
    param([Parameter(Mandatory=$true)][string]$InputJson)
    $result = Assert-PublicWindowsHealthJson -JsonUtf8 ($utf8.GetBytes($InputJson)) -ErrorAction Stop
    if ($result -ne $true) { throw 'Healthy JSON was not positively validated.' }
}
function Assert-Denied {
    param([Parameter(Mandatory=$true)][byte[]]$Bytes)
    $refused = $false
    try {
        $null = Assert-PublicWindowsHealthJson -JsonUtf8 $Bytes -ErrorAction Stop
    } catch {
        $refused = $true
        if ([string]$_.Exception.Message -cne 'Public Windows health JSON policy blocked.') {
            throw 'Health JSON rejection disclosed untrusted data.'
        }
    }
    if (-not $refused) { throw 'Ambiguous, malformed or degraded health JSON was accepted.' }
}
function Assert-JsonDenied {
    param([Parameter(Mandatory=$true)][string]$InputJson)
    Assert-Denied -Bytes ($utf8.GetBytes($InputJson))
}

# Real server shape permits additional healthy fields and retention metadata.
Assert-Accepted -InputJson '{"status":"ok","timestamp":"2026-11-20T00:00:00.000Z","uptime_seconds":1,"components":{"database":"HEALTHY","ingest_queue":"OPERATIONAL","msi_builder":"READY","audit_engine":"ACTIVE"},"data_retention":{"running":false}}'
Assert-Accepted -InputJson '{"components":{"database":"HEALTHY"},"status":"ok"}'
Assert-Accepted -InputJson '{"st\u0061tus":"ok","components":{"dat\u0061base":"HEALTHY"}}'

# Exact required fields, types and health values cannot be spoofed.
foreach ($invalid in @(
    '{}',
    '{"status":"ok"}',
    '{"status":"ok","components":{}}',
    '{"Status":"ok","components":{"database":"HEALTHY"}}',
    '{"status":"ok","Components":{"database":"HEALTHY"}}',
    '{"status":"ok","components":{"Database":"HEALTHY"}}',
    '{"status":"degraded","components":{"database":"HEALTHY"}}',
    '{"status":"ok","components":{"database":"DEGRADED"}}',
    '{"status":true,"components":{"database":"HEALTHY"}}',
    '{"status":1,"components":{"database":"HEALTHY"}}',
    '{"status":{"status":"ok"},"components":{"database":"HEALTHY"}}',
    '{"status":"ok","components":[]}',
    '{"status":"ok","components":{"database":["HEALTHY"]}}',
    '[{"status":"ok","components":{"database":"HEALTHY"}}]',
    '{"status":"ok","components":{"database":"HEALTHY"},"status":"degraded"}',
    '{"status":"degraded","status":"ok","components":{"database":"HEALTHY"}}',
    '{"status":"ok","components":{"database":"HEALTHY","database":"DEGRADED"}}',
    '{"status":"ok","components":{"database":"DEGRADED","database":"HEALTHY"}}',
    '{"status":"ok","components":{"database":"HEALTHY"},"other":{"same":1,"same":2}}',
    '{"st\u0061tus":"ok","status":"degraded","components":{"database":"HEALTHY"}}',
    '{"status":"ok","components":{"dat\u0061base":"HEALTHY","database":"DEGRADED"}}',
    '{"status":"ok","components":{"database":"HEALTHY"},"nested":[{"a":1,"a":2}]}',
    '{"status":"ok","components":{"database":"HEALTHY"},"other":NaN}',
    '{"status":"ok","components":{"database":"HEALTHY"},"other":Infinity}',
    '{"status":"ok","components":{"database":"HEALTHY"},"other":/* comment */ true}',
    '{"status":"ok","components":{"database":"HEALTHY"},}',
    '{"status":"ok","components":{"database":"HEALTHY"}}garbage',
    '{"status":"ok","components":{"database":"HEALTHY"',
    '{"status":"ok","components":{"database":"HEALTHY"},"name":"unclosed}',
    'null',
    '[]',
    ''
)) {
    Assert-JsonDenied -InputJson $invalid
}

# Byte-level payload boundary, UTF-8 BOM, malformed sequences, control chars.
Assert-Denied -Bytes ([byte[]]@(0xef,0xbb,0xbf) + $utf8.GetBytes('{"status":"ok","components":{"database":"HEALTHY"}}'))
Assert-Denied -Bytes ([byte[]]@(0xc3,0x28))
Assert-JsonDenied -InputJson ('{"status":"ok","components":{"database":"HEALTHY"},"extra":"line' + [char]10 + 'feed"}')
Assert-JsonDenied -InputJson ('{"status":"ok","components":{"database":"HEALTHY"},"payload":"' + ('x' * 65536) + '"}')
$deep = '{"status":"ok","components":{"database":"HEALTHY"},"nested":' + ('[' * 33) + '1' + (']' * 33) + '}'
Assert-JsonDenied -InputJson $deep
Write-Host 'N41 PASS: offline UTF-8, 64KiB, deep/duplicate/escaped-key negatives and healthy /healthz shape.'
