#!/usr/bin/env bash
# Offline Stage N12 fail-closed migration controls. No Docker or DB mutation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/Enterprise/deploy/migrate-legacy-msi-bootstrap.sh"
bash -n "$SCRIPT"
help="$(bash "$SCRIPT" --help)"
[[ "$help" == *"--apply --confirm HASH_ONLY"* ]] ||
  { echo 'Missing explicit migration confirmation' >&2; exit 1; }
for args in '--apply' '--apply --confirm WRONG' '--apply --confirm' '--unknown'; do
  # Intentional unquoted splitting for deterministic CLI arguments.
  # shellcheck disable=SC2086
  if bash "$SCRIPT" $args >/dev/null 2>&1; then
    echo "Unsafe migration flags were accepted: $args" >&2
    exit 1
  fi
done
grep -q 'BACKUP_KEEP=0 bash "$HERE/deploy/backup.sh"' "$SCRIPT" ||
  { echo 'Pre-mutation recovery backup guard is absent' >&2; exit 1; }
grep -q 'sha256sum --check --status' "$SCRIPT" ||
  { echo 'Pre-mutation backup digest guard is absent' >&2; exit 1; }
grep -q 'UPDATE used_bootstrap_tokens SET token = NULL' "$SCRIPT" ||
  { echo 'Redeemed token history cleanup missing' >&2; exit 1; }
echo '[PASS] Legacy MSI plaintext migration requires explicit confirmation and verified recovery backup.'
