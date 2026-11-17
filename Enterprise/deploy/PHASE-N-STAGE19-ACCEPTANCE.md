# Phase N Stage 19 — Operator-only release controls and secret hygiene

**Status: STAGE 19 CODE/CI ACCEPTED; PRODUCTION BLOCKED.** [PR #9](https://github.com/rehman2671/Aaditech-toolkit-new/pull/9) merged. [Main CI #43988981985](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988981985) SUCCESS **4/4** including Windows MSI diagnostic installation, uninstall and major-upgrade; [main safety #43988982034](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988982034) SUCCESS **2/2**. These do not certify signed publication, Hostinger live deployment or physical endpoints.

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

## Additional command audit hardening

- Removed the `simulate: true` dispatch path that previously marked remote commands completed without a signed real agent result. Command dispatch Zod schema is now strict and rejects this field with HTTP 400.
- When dispatchers specify an approved hostname, the route resolves it (previously schema allowed a hostname but handler only looked at device_id/agent_id). Tenant ownership remains verified before enqueue.
- Real device-result audit entries now use the enrolled device's verified tenant identity rather than a fabricated/default platform tenant. Admin JWTs still cannot report agent command results.

## Verified Stage 19 CI evidence (2026-11-17)

- PR [CI #43988626978](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988626978) and [safety #43988626942](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988626942) successful before squash merge.
- Main merge commit `106ec2a2e36a4f3a4858a17f1349c7c1f4298749`.
- Main CI [#43988981985](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988981985) **4/4 SUCCESS**: Node/Vitest, PowerShell, real MySQL/API faults, Windows EXE/MSI install/uninstall/upgrade diagnostic.
- Deployment safety [#43988982034](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988982034) **2/2 SUCCESS**.
- Live signed public installer, production secrets migration/recovery, external customer SMTP/Hostinger and managed physical Windows still **BLOCKED**.
