#Requires -Version 5.1
# N41 - strictly OFFLINE public /healthz response validation for future Windows
# pinned-HTTPS work. Never performs DNS, HTTP, credential or system changes.
Set-StrictMode -Version Latest

function Assert-PublicWindowsHealthJson {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][AllowEmptyCollection()][byte[]]$JsonUtf8)

    try {
        if ($JsonUtf8.Length -eq 0 -or $JsonUtf8.Length -gt 65536) {
            throw 'Size invalid.'
        }
        # Explicitly reject malformed UTF-8, BOM and control characters.
        # [Text.Encoding]::UTF8 otherwise silently replaces invalid bytes.
        $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
        $body = $utf8.GetString($JsonUtf8)
        if ($body.Length -eq 0 -or $body[0] -eq [char]0xfeff) {
            throw 'Encoding invalid.'
        }

        # ConvertFrom-Json on Windows PowerShell 5.1 does not guarantee
        # duplicate-key rejection. Before parsing, walk quoted string tokens
        # and check object key equality with Ordinal (case-sensitive) semantics.
        # Decode each key as JSON first: "st\u0061tus" and "status" must collide.
        # Full grammar checking remains ConvertFrom-Json's responsibility.
        $frames = [System.Collections.Generic.List[object]]::new()
        for ($i = 0; $i -lt $body.Length; $i++) {
            $ch = $body[$i]
            if ($ch -eq '"') {
                $start = $i
                $i++
                while ($i -lt $body.Length) {
                    if ([int]$body[$i] -lt 32) { throw 'Unescaped control character.' }
                    if ($body[$i] -eq '\') {
                        $i += 2
                        continue
                    }
                    if ($body[$i] -eq '"') { break }
                    $i++
                }
                if ($i -ge $body.Length) { throw 'Unclosed JSON string.' }
                if ($frames.Count -gt 0) {
                    $frame = $frames[$frames.Count - 1]
                    if ($frame.kind -ceq 'object' -and $frame.expectKey) {
                        $keyToken = $body.Substring($start, $i - $start + 1)
                        $key = ConvertFrom-Json -InputObject $keyToken -ErrorAction Stop
                        if ($key -isnot [string] -or -not $frame.keys.Add($key)) {
                            throw 'Duplicate or malformed JSON key.'
                        }
                        if ($frame.keys.Count -gt 1024) { throw 'Too many JSON keys.' }
                        $frame.expectKey = $false
                    }
                }
                continue
            }

            switch ([string]$ch) {
                '{' {
                    $frames.Add([pscustomobject]@{
                        kind='object'
                        expectKey=$true
                        keys=[System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
                    })
                }
                '[' {
                    $frames.Add([pscustomobject]@{kind='array';expectKey=$false})
                }
                '}' {
                    if ($frames.Count -eq 0 -or $frames[$frames.Count - 1].kind -cne 'object') {
                        throw 'Invalid JSON nesting.'
                    }
                    $frames.RemoveAt($frames.Count - 1)
                }
                ']' {
                    if ($frames.Count -eq 0 -or $frames[$frames.Count - 1].kind -cne 'array') {
                        throw 'Invalid JSON nesting.'
                    }
                    $frames.RemoveAt($frames.Count - 1)
                }
                ',' {
                    if ($frames.Count -gt 0) {
                        $frame = $frames[$frames.Count - 1]
                        if ($frame.kind -ceq 'object') { $frame.expectKey = $true }
                    }
                }
                default {
                    # Refuse non-JSON tokens (NaN/Infinity/comments) even if a
                    # future shell implementation becomes more permissive.
                    if (-not ('{}[],:-+0123456789.eE truefalsnul' +
                             [string][char]9 + [string][char]10 + [string][char]13).Contains([string]$ch)) {
                        throw 'Non-JSON token.'
                    }
                }
            }
            if ($frames.Count -gt 32) { throw 'JSON nesting limit.' }
        }
        if ($frames.Count -ne 0) { throw 'Unbalanced JSON.' }

        $parsed = ConvertFrom-Json -InputObject $body -ErrorAction Stop
        if ($null -eq $parsed -or $parsed -isnot [pscustomobject]) {
            throw 'Health root must be an object.'
        }
        # Exact, case-sensitive schema fields. Other server health fields can
        # exist, but they cannot substitute for root status or components.
        $status = @($parsed.PSObject.Properties | Where-Object { $_.Name -ceq 'status' })
        $components = @($parsed.PSObject.Properties | Where-Object { $_.Name -ceq 'components' })
        if ($status.Count -ne 1 -or $components.Count -ne 1 -or
            $status[0].Value -isnot [string] -or $status[0].Value -cne 'ok' -or
            $components[0].Value -isnot [pscustomobject]) {
            throw 'Health status invalid.'
        }
        $database = @($components[0].Value.PSObject.Properties |
            Where-Object { $_.Name -ceq 'database' })
        if ($database.Count -ne 1 -or $database[0].Value -isnot [string] -or
            $database[0].Value -cne 'HEALTHY') {
            throw 'Persistent database not ready.'
        }
        return $true
    } catch {
        # Never reveal an untrusted body, field name, host or credential.
        throw 'Public Windows health JSON policy blocked.'
    }
}

Export-ModuleMember -Function Assert-PublicWindowsHealthJson
