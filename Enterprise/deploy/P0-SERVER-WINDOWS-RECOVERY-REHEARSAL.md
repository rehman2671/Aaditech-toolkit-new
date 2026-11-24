# Combined P0 server and Windows recovery rehearsal

This review-only tree incorporates #101 (agent durable result recovery, #99/#100), #93 (persistent MySQL and current user authorization outside tests, truthful health, approved MSI distribution and TLS boundary) and #94 (read-only Windows prerequisite verification). The source heads are recorded below. Overlapping db.js, server.js, API integration tests and CI workflow were reconciled using exact context matches and an explicit CI insertion, not file replacement. Nonoverlapping changed files imported by their Git blob identities.

- #101: 2de65f53bda3bc938541c47d55436586ce732eff
- #93: d7e84ce9b7c50ce25645f53a80ee77a2d8296516
- #94: 6865f0f715a424388c112f3fae9ba629d236aa58

Fresh combined CI required. Not a release or proof of LAN install/physical signed endpoint acceptance. Other open PRs, including #85, #86 and #76, require explicit review and reconciliation. Public-trust production TLS boundary is intentional in this tree and does not provide internal LAN PKI. Stack owner ADR remains open. No direct main merge, signing, deployment, or production acceptance.
