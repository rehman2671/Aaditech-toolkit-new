#Requires -Version 5.1
# N60: GitHub draft releases can exist without a Git tag ref.
# Only PUBLICATION may create the ref; never confuse absence of a draft
# tag with an API error or accept a tag pointing to another source SHA.
Set-StrictMode -Version Latest

function Assert-N60ReleaseTagState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$TagRefsJson,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedTag,
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$ExpectedSourceSha,
        [switch]$RequireDraft,
        [switch]$RequirePublished
    )
    try {
        if ($env:OS -cne 'Windows_NT' -or
            ($RequireDraft.IsPresent -eq $RequirePublished.IsPresent) -or
            $ExpectedTag -cnotmatch '\Aagent-v(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,3})-r(?:[1-9]|[1-9][0-9]{1,2})\z' -or
            $ExpectedSourceSha -cnotmatch '\A[0-9a-f]{40}\z' -or
            [string]::IsNullOrWhiteSpace($TagRefsJson) -or
            $TagRefsJson.Length -gt 131072 -or
            $TagRefsJson.TrimStart() -cnotmatch '\A\[') {
            throw 'Untrusted GitHub ref record or release lifecycle state.'
        }
        $parsed=ConvertFrom-Json -InputObject $TagRefsJson -ErrorAction Stop
        $refs=@($parsed | Where-Object { $null -ne $_ })
        $exactRefs=@($refs | Where-Object {
            [string]$_.ref -ceq ('refs/tags/'+$ExpectedTag)
        })
        foreach ($entry in $refs) {
            if ($null -eq $entry -or
                [string]$entry.ref -cnotmatch '\Arefs/tags/[A-Za-z0-9._-]+\z') {
                throw 'Malformed remote Git tag list.'
            }
        }
        if ($RequireDraft) {
            # A draft has a pending *tag name* in its Release metadata but
            # must not have a publicly reachable Git ref yet.
            if ($exactRefs.Count -ne 0) { throw 'Draft tag exists before approved publication.' }
        } else {
            # Once published, GitHub creates the tag (when absent at draft
            # stage). Require EXACT approved source: never trust name alone.
            if ($exactRefs.Count -ne 1 -or
                [string]$exactRefs[0].object.type -cne 'commit' -or
                [string]$exactRefs[0].object.sha -cne $ExpectedSourceSha) {
                throw 'Published tag does not point at approved source commit.'
            }
        }
        return $true
    } catch {
        throw 'N60 GitHub release tag provenance blocked.'
    }
}
Export-ModuleMember -Function Assert-N60ReleaseTagState
