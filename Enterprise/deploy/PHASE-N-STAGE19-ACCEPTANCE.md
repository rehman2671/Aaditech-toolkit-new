# Phase N Stage 19 — Operator-only release controls and secret hygiene

**Status:** Code change submitted; independent CI pending; production certification remains blocked.

## Fixed authorization and secret handling
- `PUT /api/v1/agent/update-target` requires an explicit persistent platform operator identity. In production it additionally requires a matching approved MSI SHA256 and an actual versioned artifact, not a user's claimed version.
- `GET /api/v1/build/status` and `POST /api/v1/build/trigger` require platform operator permission, not merely any valid workspace token.
- GitHub Actions credentials and destination are configured via *private server* `GITHUB_ACTIONS_TOKEN` and exact `GITHUB_ACTIONS_REPO` only. Empty disables all trigger actions. The API never takes `repo` or `token` from the browser; branch is pinned to main. Requests to GitHub use a fixed https://api.github.com origin, 8-second timeout and redirect blocking.
- Setup wizard does not collect a GitHub PAT; migration `007_scrub_legacy_github_pat.sql` deletes historically persisted branding.github_token without logging it. The DB branding layer drops that legacy field on reads/writes.
- Build status distinguishes NOT_CONFIGURED, NO_RUNS, NETWORK_UNAVAILABLE and UPSTREAM_UNAVAILABLE from verified remote CI results. Successful dispatch means *accepted by GitHub* only; signing/publication remain human-owned separate processes.

## Operator acceptance
- Configure optional server env `GITHUB_ACTIONS_REPO` and `GITHUB_ACTIONS_TOKEN` only if you explicitly authorize remote CI dispatch; otherwise remain disabled.
- Confirm `PLATFORM_ADMIN_USER_ID`, `PLATFORM_OWNER_TENANT_ID` are actual persisted production operator IDs. Test workspace SUPER_ADMIN cannot mutate global settings or start builds.
- The already-present publisher-approved `.github/workflows/publish-signed-installer.yml` remains manual and gated; no signing keys should be entered in app settings.
- Before real customer rollout, require signed public MSI approval, physical Windows install/UAC/upgrade, approved production MySQL offsite restore, actual Hostinger VPS/TLS and verified SMTP inbox receipt.
