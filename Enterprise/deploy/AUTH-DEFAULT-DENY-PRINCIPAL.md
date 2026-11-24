# Default-deny current-user JWT authorization

**Status:** Code proposal. Needs independent security review, exact-head CI and real deployment tests.

A signed JWT carries claims and is **not** independent proof that the user still exists or has an active tenant membership. The server's previous `resolveCurrentUserPrincipal` looked up the current user/membership only when `NODE_ENV === 'production'`, allowing staging/development/undefined deployments to accept claims without current DB verification. A leaked or previously authorized JWT could retain an outdated role in these modes.

The underlying `resolveVerifiedUserPrincipal` helper also defaults its mode argument to **persistent authorization**; omitting the argument must not silently trust signed JWT claims without current database identity.

This patch aligns the principal admission gate with the server's existing secure-setup policy: **every environment except explicit `NODE_ENV=test`** requires fresh persistent user state and (for secondary workspaces) an active membership and matching role. Missing or disconnected DB, disabled users, stale roles and revoked workspace memberships fail closed in the normal runtime. Unit tests exercise unset/staging/development/prod mode-selection and the existing production negative principal fixtures; CI uses explicit `NODE_ENV=test` only for isolated fixtures.

This does **not** authorize using test mode in any internet-facing or intranet production deployment. It does not repair old compromised JWT secrets, provide full distributed revocation, implement an offline server installer, or select the unapproved original Go/PostgreSQL versus current Node/MySQL stack. Real MySQL failover and production acceptance remain independent.
