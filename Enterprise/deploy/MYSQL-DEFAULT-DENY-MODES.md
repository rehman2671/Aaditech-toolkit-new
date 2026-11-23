# P0 persistent MySQL fail-closed across runtime modes

**Review-stage code** — no production acceptance, architecture selection, physical LAN install or merge approval.

Previously `db.js` recognized the persistent MySQL-only security boundary **only** when `NODE_ENV === 'production'`. A staging, development, Windows office install or accidentally unset environment would silently fall back to mutable, synthetic in-memory demo users/devices/tokens/commands/events on MySQL disconnection or SQL failures. This can falsely report a functioning application and lose tenant/device state on restart. The public `/healthz` also returned HTTP 200 in those modes, and a `VITEST` environment value could suppress a production health failure.

This proposal changes every former production-only fallback/identity/tenant condition in `db.js` to mean **any environment other than explicit `NODE_ENV=test`**. The in-memory SQL emulator, demo device cache, loose credentials, local admission locks and automatic local MariaDB start are now **test-only**. Real deployment must have configured DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, valid port/pool size and an available persistent database. If MySQL is unavailable or query fails, SQL-dependent operations reject rather than substitute demo rows. `/healthz` returns HTTP **503** with `database: DEGRADED` outside test when DB probe fails, independent of `VITEST` flags.

**Compatibility change:** local development without MySQL now refuses to operate in fake production mode. Stand up a real isolated database for developer/manual tests; automated CI fixtures set `NODE_ENV=test` explicitly. Never deploy the test profile to an office or publicly reachable server. This PR does not implement Go/PostgreSQL requested in the original directive, nor an offline installer or database backup/restore workflow. Original architecture decision #79 must remain unresolved until owner approval.

New tests: `tests/unit/db-mode-default-deny.test.js` covers five runtime modes, demo-identity denial, upstream MySQL query error, HTTP readiness 503 and isolated test fixture. Existing `production-db-failclosed.test.js` continues to cover exact production conditions.

Before a protected release: independently review all callers that relied on non-test memory fallback, verify production and staging DB-fault injection, data integrity after reconnect, real Windows installer and disconnected office LAN acceptance. Branch ruleset blocker #62 remains open.
