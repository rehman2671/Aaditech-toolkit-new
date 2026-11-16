# Phase N Stage 7 — Real multi-process HTTP enrollment acceptance

**Status: real HTTP concurrency rehearsal PASSED in GitHub CI; NOT PRODUCTION CERTIFIED.**

## Scope

`test-http-tenant-concurrency.js` launches **two independent production-mode
Express API processes** on separate loopback ports, connected to the **same
disposable MySQL 8 service**. HTTP requests exercise the real API routes,
not an extracted helper or mocked database.

It creates two synthetic tenants, companies and JWT-backed administrative
users, then verifies:

- Competing cross-tenant `POST /api/v1/agent/enroll` requests for the same
  hostname with distinct UIDs: exactly one HTTP 201, losers HTTP 409, and
  exactly one persistent hostname owner.
- The reverse (same UID across different hostnames/workspaces): one 201,
  other contenders 409, one persistent UID owner.
- A rejected 409 does **not** consume its one-use bootstrap token; the
  rejected token can enroll a truly new device.
- Two API instances redeeming **one identical** single-use bootstrap token
  for different devices: exactly one 201, one 401, one database token-use
  row, and `used_bootstrap_tokens.token IS NULL`.
- Competing cross-tenant `POST /api/v1/devices` with distinct, real
  MySQL-backed administrator JWTs: one 201 and all remaining 409.
- Independent enrollment requests to both workers remain successful.

## Isolation and safety

The runner requires `GITHUB_ACTIONS=true`,
`AADITECH_HTTP_REHEARSAL=isolated-ci`, `NODE_ENV=test` in the harness,
and `DB_NAME=it_toolkit`. Spawned **server processes** run
`NODE_ENV=production`, have explicit ephemeral CI secrets, and must pass
`/healthz` with a healthy MySQL state before the workload starts. No
external URLs, real hostnames, live credentials or Hostinger accounts are
used. Synthetic devices, user accounts, companies, tenants and token-use
rows are deleted in cleanup even on assertion failure.

## CI evidence

GitHub Actions run
[#43870822762](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43870822762)
executed this gate in its `API test suite (Node.js vs MySQL 8)` job,
after lower-level advisory-lock concurrency checks. Its log explicitly
confirmed: two healthy production-mode HTTP workers; hostname contention,
UID contention, one-use token replay (hash-only), rejected-token reuse,
JWT-backed cross-tenant registration and independent enrollment all PASSED.
The HTTP integration job completed successfully. The full four-job CI
status and Windows MSI job must be verified separately for a release.

## Not covered

Separate failures of actual Hostinger replicas, reverse proxy/load-balancer
behavior, long-running DB/network partitions, deployment secrets and
certificate management, and real Windows/GUI/Authenticode acceptance
remain outstanding. There is still no live production rollout approval.
