# Diagnostic review consent and local runtime configuration — source candidate

## Consent

Requires persistent migration 023, enabled report identity adapter, explicit bearer and active primary-tenant assignment. On an OPEN employee-origin incident with hazard NONE and catalog diagnostic, SUPER_ADMIN may REQUEST once; MONITORING owner may GRANT or DENY before DB-clock expiry (24 hours) and REVOKE a grant. Revision and exact request UUID are checked; state, event and audit persist together. No renewal/regrant in this version. GET/POST /api/v1/troubleshooting/diagnostic-consent. GET exact incidentId, deviceId; POST adds requestId, expectedRevision, action, confirmation CONFIRM_<ACTION>_DIAGNOSTIC_REVIEW_ONLY. No collection, repair or resolution authority. Real HTTP/SQL/physical tests still required.

## Windows connection-only check

Existing Configure-Agent.ps1 supports -ServerUrl https://<approved-host> -ProbeOnly -NonInteractive; GUI has Test connection only. HTTPS certificate and database health must pass without redirection. No enrollment token accepted, configuration not read or written, no enrollment verified. Normal configuration retains existing optional health check. Physical private CA, service-account trust and actual enrollment remain separate acceptance gates.

## Runtime configuration candidate

Linux owner-only local operator tool: node scripts/prepare-runtime-configuration-cli.mjs --prepare-runtime-configuration, with bounded JSON on stdin. Fields: confirmation PREPARE_RUNTIME_CONFIGURATION_CANDIDATE_ONLY, profile compose or node, canonical activePath to .env, expectedActiveSha256, separate dedicated private lockRoot, changes. Compose changes exactly serverHost (updates SERVER_HOST and CADDY_HOST). Node changes exactly serverHost, port, dbHost, dbPort, dbName. Existing active .env must be regular single-link 0600, canonical owner-only 0700 parent, simple LF dotenv syntax, no duplicate keys, quotes or multiline values. Candidate is .env.candidate in same directory, owner-only 0600, no overwrite. Candidate includes existing secrets; do not display, share, or commit it. Only digest and changed key names returned. Active config unchanged; no TLS, DB, runtime activation or restart performed. Approved host topology, DB credential/identity continuity, reviewed activation and rollback remain mandatory.
