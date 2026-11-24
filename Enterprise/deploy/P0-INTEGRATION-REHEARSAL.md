# P0 integration rehearsal — persistent DB, current principal, truthful health, signed MSI distribution

**Status: INTEGRATION-ONLY CI PROPOSAL, NOT A PRODUCTION RELEASE OR INDEPENDENT CODE APPROVAL.**

This branch combines exact code/test changes from five separately open P0 PRs against **main `911f509620029c513305c88b26ca0da4e1b7da37`** solely to expose cross-feature regressions before review/merge:

- [#88](https://github.com/rehman2671/Aaditech-toolkit-new/pull/88) — never report imaginary MSI/queue/audit readiness.
- [#89](https://github.com/rehman2671/Aaditech-toolkit-new/pull/89) — unsigned MSI distribution fails closed except isolated test fixtures.
- [#90](https://github.com/rehman2671/Aaditech-toolkit-new/pull/90) — deployed user principal and workspace membership always re-authorize against the database.
- [#92](https://github.com/rehman2671/Aaditech-toolkit-new/pull/92) — non-test HTTPS agent-origin, secure session cookies, legacy CA and synthetic password default-deny.
- [#91](https://github.com/rehman2671/Aaditech-toolkit-new/pull/91) — all non-test runtimes require MySQL; HTTP readiness/API/startup fail closed. Includes the HMAC 403-vs-DB 503 fixture fix from `14d4a8f8cadfa8df58c8e135d7f800712a1731ab`.

The shared `server.js` edits are reconciled manually: N91 database admission; N90 authenticated principal import and authorization; N88 truthful /healthz component statuses; N92 HTTPS/CA/session/agent distribution guards. `agent-artifacts.js` retains N89 signed-MSI refusal and N92 legacy CA denial. The original PRs are **not superseded or approved by this experiment**. Their independent human security reviews, actual merge order, retarget/main CI and production release admission remain required.

## CI acceptance

- [ ] Full CI passes Node/Vitest+MySQL 8, API/MySQL 8 and Windows PowerShell with source changes combined.
- [ ] Deployment safety passes offline checks and isolated MySQL restore.
- [ ] Explicit `NODE_ENV=test` fixtures cannot enable non-test in-memory DB, stale-user authorization, unsigned production distribution, attacker-controlled agent Host/HTTP, insecure session cookies, or legacy root CA download.
- [ ] Production-mode absent DB returns 503; connected DB with invalid HMAC returns 403; readiness does not invent worker/MSI readiness.
- [ ] Independent human review and protected main merge (separate from this PR) followed by diagnostic Windows MSI and physical acceptance evidence.

## Open release gates

No local office installer, WAN-disconnected E2E, real signed MSI/publisher key custody, protected main reviewer/ruleset, physical Windows signed command/ACK, encrypted offsite restore, externally verified CA or production deployment is supplied here. Owner ADR DEC-001 remains pending. **Production: NOT APPROVED.**

## Combined cross-feature staging runtime E2E contract

New deterministic `tests/integration/p0-non-test-security-boundaries.integration.test.js` exercises all guards in a single imported server/app context:

- DB-disconnected `NODE_ENV=staging`: healthz 503 with database DEGRADED and no invented MSI/worker READY; agent poll 503 DATABASE_UNAVAILABLE despite a forged Host and HMAC header; no generated CA, agent Host fallback, or stale JWT principal default acceptance.
- DB-connected staging mock: agent origin is operator-owned HTTPS; both legacy CA routes refuse 410 without contacting SQL. The mock is **only an isolated test fixture**, not customer DB certification.

The old four/five-feature green CI runs precede this added regression. **Latest exact HEAD must pass full CI and deployment safety** before treating the combined branch as regression verified. This does not establish deployed MSI signing, real DB replicas, LAN PKI or customer source-to-incident E2E.

## N92 integrated test checkpoint

The new shared-source reconciliation includes [#92](https://github.com/rehman2671/Aaditech-toolkit-new/pull/92) code/test fixtures **only in this draft**. Recheck the latest exact integration head CI after the combined commit; historical #93 green runs are not proof of this addition. External LAN internal CA design remains blocked by DEC-001 and does not follow from this public-DNS posture.
