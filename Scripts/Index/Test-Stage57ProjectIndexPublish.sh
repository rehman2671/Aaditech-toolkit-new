#!/usr/bin/env bash
# N57 offline integration regression. Uses a disposable local bare Git
# remote; never accesses GitHub, a customer endpoint, or production data.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
publisher="$repo_root/Scripts/Index/Publish-ProjectIndex.sh"
bash -n "$publisher"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

remote="$tmp/origin.git"
seed="$tmp/seed"
runner="$tmp/runner"
injector="$tmp/injector"
verify="$tmp/verify"
marker="$tmp/race-marker"
git init --bare --quiet --initial-branch=main "$remote"
git init --quiet --initial-branch=main "$seed"
git -C "$seed" config user.email "n57-test@example.invalid"
git -C "$seed" config user.name "N57 Fixture"
git -C "$seed" remote add origin "$remote"
mkdir -p "$seed/Scripts/Index"
cp "$publisher" "$seed/Scripts/Index/Publish-ProjectIndex.sh"
printf 'initial source\n' > "$seed/source.txt"
for report in project-index.json project-state.json project-progress.json; do
  printf '{"path":"%s","source":"stale","production_ready":false}\n' "$report" > "$seed/$report"
done

# Minimal test-only indexer with the *same* -Check semantics as the real
# indexer. It pushes a competing SOURCE commit from another local clone
# during the first generation to guarantee a non-fast-forward race.
cat > "$seed/Scripts/Index/Update-ProjectIndex.ps1" <<'PS1'
[CmdletBinding()]
param([switch]$Check)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ($env:INDEX_TEST_INJECTOR -and $env:INDEX_TEST_RACE_MARKER -and
    -not (Test-Path -LiteralPath $env:INDEX_TEST_RACE_MARKER)) {
    'injected' | Set-Content -LiteralPath $env:INDEX_TEST_RACE_MARKER
    'new source after competing push' | Set-Content -LiteralPath (Join-Path $env:INDEX_TEST_INJECTOR 'source.txt')
    & git -C $env:INDEX_TEST_INJECTOR add -- source.txt
    & git -C $env:INDEX_TEST_INJECTOR commit -q -m 'test: concurrent source change'
    if ($LASTEXITCODE -ne 0) { throw 'N57 synthetic race commit failed.' }
    & git -C $env:INDEX_TEST_INJECTOR push -q origin HEAD:refs/heads/main
    if ($LASTEXITCODE -ne 0) { throw 'N57 synthetic competing push failed.' }
}
$source=(Get-Content -LiteralPath (Join-Path $root 'source.txt') -Raw).Trim()
$head=(& git -C $root rev-parse HEAD).Trim()
$reports=@('project-index.json','project-state.json','project-progress.json')
$stale=$false
foreach ($name in $reports) {
    $path=Join-Path $root $name
    $previous=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($previous.source -cne $source) { $stale=$true }
    $report=[ordered]@{
        path=$name
        source=$source
        last_verified_commit=$head
        production_ready=$false
    }
    $report | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $path
}
if ($Check) {
    if ($stale) {
        Write-Host 'INDEX CHECK FAILED. Synthetic fixture is stale.'
        exit 1
    }
    foreach ($name in $reports) { & git -C $root checkout -- $name }
    Write-Host 'Index is up to date.'
    exit 0
}
PS1

git -C "$seed" add -- .
git -C "$seed" commit -qm 'test: initial stale project metadata'
git -C "$seed" push -q -u origin HEAD:refs/heads/main
git clone -q "$remote" "$runner"
git clone -q "$remote" "$injector"
git -C "$injector" config user.email "n57-injector@example.invalid"
git -C "$injector" config user.name "N57 Concurrency Fixture"

# Race: source edit is pushed AFTER the runner fetches its first base,
# DURING its index regeneration, BEFORE its first push.
(
  cd "$runner"
  GITHUB_ACTIONS=true GITHUB_REF=refs/heads/main GITHUB_EVENT_NAME=push \
    INDEX_TEST_INJECTOR="$injector" INDEX_TEST_RACE_MARKER="$marker" \
    bash Scripts/Index/Publish-ProjectIndex.sh
)
git clone -q "$remote" "$verify"
if [[ "$(cat "$verify/source.txt")" != "new source after competing push" ]]; then
  echo "N57 FAIL: collaborator source commit was lost." >&2
  exit 1
fi
if [[ "$(git -C "$verify" rev-list --count main)" -ne 3 ]]; then
  echo "N57 FAIL: expected original, competing and current index commits." >&2
  exit 1
fi
parent="$(git -C "$verify" rev-parse HEAD^)"
for report in project-index.json project-state.json project-progress.json; do
  REPORT_FILE="$verify/$report" REPORT_NAME="$report" EXPECTED_PARENT="$parent" \
    pwsh -NoProfile -Command \
      '$m = Get-Content -LiteralPath $env:REPORT_FILE -Raw | ConvertFrom-Json; if ($m.source -cne "new source after competing push" -or $m.last_verified_commit -cne $env:EXPECTED_PARENT -or $m.production_ready -ne $false -or $m.path -cne $env:REPORT_NAME) { throw "N57 regenerated report did not use latest source." }' \
    2>&1
done
head="$(git -C "$verify" rev-parse HEAD)"
# Running again with no source changes must not create another metadata
# commit from timestamps/HEAD churn.
(
  cd "$runner"
  GITHUB_ACTIONS=true GITHUB_REF=refs/heads/main GITHUB_EVENT_NAME=push \
    bash Scripts/Index/Publish-ProjectIndex.sh
)
new_head="$(git -C "$verify" ls-remote origin refs/heads/main | cut -f1)"
if [[ "$new_head" != "$head" ]]; then
  echo "N57 FAIL: no-op regeneration created another index commit." >&2
  exit 1
fi

# Never publish a report from non-main or non-Actions context.
if (
  cd "$runner"
  GITHUB_ACTIONS=true GITHUB_REF=refs/heads/feature GITHUB_EVENT_NAME=push \
    bash Scripts/Index/Publish-ProjectIndex.sh >/dev/null 2>&1
); then
  echo "N57 FAIL: non-main index publisher was allowed." >&2
  exit 1
fi
if (
  cd "$runner"
  GITHUB_ACTIONS=false GITHUB_REF=refs/heads/main GITHUB_EVENT_NAME=push \
    bash Scripts/Index/Publish-ProjectIndex.sh >/dev/null 2>&1
); then
  echo "N57 FAIL: non-CI index publisher was allowed." >&2
  exit 1
fi

# A denied push with NO competing commit must fail instead of retrying
# indefinitely, rewriting history, or overwriting source.
git -C "$injector" pull -q --ff-only origin main
printf 'another committed source\n' > "$injector/source.txt"
git -C "$injector" add -- source.txt
git -C "$injector" commit -qm 'test: independent new source'
git -C "$injector" push -q origin HEAD:refs/heads/main
printf '#!/bin/sh\nexit 1\n' > "$remote/hooks/pre-receive"
chmod +x "$remote/hooks/pre-receive"
if (
  cd "$runner"
  GITHUB_ACTIONS=true GITHUB_REF=refs/heads/main GITHUB_EVENT_NAME=push \
    bash Scripts/Index/Publish-ProjectIndex.sh >/dev/null 2>&1
); then
  echo "N57 FAIL: denied, non-racing remote push incorrectly succeeded." >&2
  exit 1
fi
if [[ "$(git -C "$verify" ls-remote origin refs/heads/main | cut -f1)" != \
      "$(git -C "$injector" rev-parse HEAD)" ]]; then
  echo "N57 FAIL: remote source was changed by denied report upload." >&2
  exit 1
fi
echo 'N57 PASS: latest-main regeneration, safe race retry, no-op idempotence, main-only guard, hard-denied push and no forced overwrite.'
