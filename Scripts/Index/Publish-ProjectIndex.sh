#!/usr/bin/env bash
# Phase N57: CI-only, non-force project index publication.
# Rebuild from the *latest* main commit on each retry; never rebase a
# previously generated report over changed repository contents.
set -euo pipefail

if [[ $# -ne 0 || "${GITHUB_ACTIONS:-}" != "true" ||
      "${GITHUB_REF:-}" != "refs/heads/main" ||
      ( "${GITHUB_EVENT_NAME:-}" != "push" &&
        "${GITHUB_EVENT_NAME:-}" != "workflow_dispatch" ) ]]; then
  echo "N57: main-branch CI-only index publishing required." >&2
  exit 2
fi

repo="$(git rev-parse --show-toplevel)"
cd "$repo"
reports=(project-index.json project-state.json project-progress.json)
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "N57: refusing to discard a modified tracked checkout." >&2
  exit 2
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "N57: main source remote is missing." >&2
  exit 2
fi
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Four attempts bound work even under an active push storm. No force-push,
# push lease override, hidden branch writes or indefinite background retries.
for attempt in 1 2 3 4; do
  echo "N57: attempt $attempt/4; refreshing from origin/main."
  git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main
  base="$(git rev-parse --verify refs/remotes/origin/main)"
  if [[ ! "$base" =~ ^[0-9a-f]{40}$ ]]; then
    echo "N57: invalid remote main commit." >&2
    exit 2
  fi

  # Ephemeral clean CI checkout only. A previous attempt's own metadata
  # commit may be discarded; a collaborator's remote commit is never reset.
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "N57: unexpected tracked modifications before retry." >&2
    exit 2
  fi
  git reset --hard --quiet "$base"

  # The indexer's existing -Check mode performs one regeneration, compares
  # semantic content with committed metadata, and restores files if fresh.
  # A stale report is a controlled exit 1, not a script execution failure.
  if check_log="$(pwsh -NoProfile -File Scripts/Index/Update-ProjectIndex.ps1 -Check 2>&1)"; then
    if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
      echo "N57: fresh check unexpectedly modified tracked files." >&2
      exit 1
    fi
    echo "N57: index is meaningfully fresh at $base; no commit necessary."
    exit 0
  fi
  if [[ "$check_log" != *"INDEX CHECK FAILED."* ]]; then
    echo "N57: indexer error (not a controlled stale-index result)." >&2
    echo "$check_log" >&2
    exit 1
  fi

  # Indexer may ONLY modify its three generated tracked JSON reports. Any
  # modification to application/source files is a hard failure.
  for file in "${reports[@]}"; do
    if [[ ! -f "$file" ]]; then
      echo "N57: required generated report is missing." >&2
      exit 1
    fi
  done
  git add -- "${reports[@]}"
  if ! git diff --quiet; then
    echo "N57: indexer unexpectedly modified non-report tracked files." >&2
    exit 1
  fi
  for file in "${reports[@]}"; do
    REPORT_NAME="$file" pwsh -NoProfile -Command \
      '$m = Get-Content -LiteralPath $env:REPORT_NAME -Raw | ConvertFrom-Json -ErrorAction Stop; if ($m.path -cne $env:REPORT_NAME -or $m.production_ready -eq $true -or $m.release_readiness.production_ready -eq $true) { throw "N57 invalid report metadata or production state." }'
  done

  if git diff --cached --quiet; then
    echo "N57: no index file changes to commit."
    exit 0
  fi
  unexpected="$(git diff --cached --name-only | grep -Ev '^(project-index|project-state|project-progress)\.json$' || true)"
  if [[ -n "$unexpected" ]]; then
    echo "N57: staged non-report content refused." >&2
    exit 1
  fi

  git commit --quiet -m "chore(index): refresh project metadata [skip ci]"
  if git push --porcelain origin HEAD:refs/heads/main; then
    echo "N57: current project metadata safely published on attempt $attempt."
    exit 0
  fi

  # Distinguish a normal collaborator race from an access/network failure
  # or a rewritten main history. Retrying is only valid on a descendant
  # of the previously fetched main commit.
  git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main
  latest="$(git rev-parse --verify refs/remotes/origin/main)"
  if [[ "$latest" == "$base" ]] || ! git merge-base --is-ancestor "$base" "$latest"; then
    echo "N57: push rejected without safe main advancement; no overwrite or retry." >&2
    exit 1
  fi
  echo "N57: main advanced after regeneration; rerun indexer against new source HEAD."
done

echo "N57: main kept advancing across four attempts; release metadata not overwritten." >&2
exit 1
