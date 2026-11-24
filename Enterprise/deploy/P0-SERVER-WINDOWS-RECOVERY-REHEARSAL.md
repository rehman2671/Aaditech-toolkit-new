# Combined P0 server and Windows recovery rehearsal

This review-only tree incorporates #101 (agent durable result recovery, #99/#100), #93 (persistent MySQL and current user authorization outside tests, truthful health, approved MSI distribution and TLS boundary) and #94 (read-only Windows prerequisite verification). The source heads are recorded below. Overlapping db.js, server.js, API integration tests and CI workflow were reconciled using exact context matches and an explicit CI insertion, not file replacement. Nonoverlapping changed files imported by their Git blob identities.

- #101: 2de65f53bda3bc938541c47d55436586ce732eff
- #93: d7e84ce9b7c50ce25645f53a80ee77a2d8296516
- #94: 6865f0f715a424388c112f3fae9ba629d236aa58

Fresh combined CI required. Not a release or proof of LAN install/physical signed endpoint acceptance. Also incorporates #76 Windows enrollment ACL, #85 consolidated portal/Docker/tenant-MSI safeguards (instead of overlapping #81/#82/#84), and #86 read-only LAN bundle integrity verifier. The #85 portal preserves #97 reboot refusal; #85 server changes applied to the combined server. #76 native PS 5.1 ACL test preserved. #86 provides hash verification, not an offline installer. Public-trust production TLS boundary is intentional in this tree and does not provide internal LAN PKI. Stack owner ADR remains open. No direct main merge, signing, deployment, or production acceptance.

Additional exact heads:
- #76: b56eaf9e97d14e3cc9e81440b618c981e44ad3ef
- #85: 73c4d5f7ff5c8aab9c36ecd8f60821dbc59fb1a8
- #86: 4a21676e496a4826574fa2c85c539fdd46277da7
