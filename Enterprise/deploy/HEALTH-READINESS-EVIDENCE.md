# Operational health response: evidence boundaries

**Status: code proposal, independent review and fresh CI required. Not a production sign-off.**

The public `/healthz`, `/api/health` and `/api/v1/health` responses have a real MySQL readiness probe. However, the historic fixed responses `msi_builder=READY`, `ingest_queue=OPERATIONAL` and `audit_engine=ACTIVE` did **not** call any respective subsystem readiness check. They could mislead operators into thinking an in-platform signed Windows MSI factory, active ingestion queue or durable audit worker were live.

This code change preserves `components.database` and the existing top-level production DB-based status/HTTP 503 gate, while changing the three **unprobed** component statuses to `EXTERNAL_SIGNING_REQUIRED` for MSI and `NOT_VERIFIED` for ingest/audit. These are informative capability/evidence labels, not health checks. No cryptographic signing, MSI publication, queue probe, audit acceptance, physical enrollment or LAN installer is created by this PR.

Consumers must read `components.database` and HTTP status for health admission, not assume every informational component is green; see `Enterprise/deploy/validate-public-health.py`. A future **separate reviewed implementation** may expose measured worker readiness if the probe observes actual backing stores and excludes synthetic/old data. Do not convert `EXTERNAL_SIGNING_REQUIRED` to `READY` based on a package request row, an MSI file on disk or a green unsigned CI build.

Tests: `tests/unit/health-readiness-truthfulness.test.js` exercises all public aliases and prevents false-positive readiness regressions. Target `main` production still requires independent branch protection, approved signer, actual signed release, offline office installer and witnessed customer acceptance.
