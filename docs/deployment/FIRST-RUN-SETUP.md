# Aaditech Toolkit: Secure first-run setup and editable configuration

**Release status: NOT PRODUCTION READY.** This document covers development deployment of the Node.js/MySQL server and six-step first-run wizard. The Windows endpoint MSI and HTTPS/mTLS release gates are separate and remain unverified.

## Supported first-run modes

Windows 10/11 with Docker Desktop + WSL2, or Linux with Docker Engine and Compose. First-run setup is only exposed on host loopback: http://localhost:3000.

## Install

1. Install Docker Desktop/Engine and clone the repository.
2. Windows: run PowerShell script Enterprise/deploy/first-run.ps1. Linux: run bash Enterprise/deploy/first-run.sh.
3. The script creates Enterprise/.env with random MySQL passwords only when it does not already exist. Existing database volumes and passwords are retained.
4. Start MySQL and API containers with Docker Compose. The API startup creates six persisted strong app secrets in /data and generates /data/first-run-setup-code. The secrets are never shown by HTTP endpoints.
5. On the same host open http://localhost:3000/. Retrieve the setup code with:

    docker compose --env-file Enterprise/.env -f Enterprise/docker-compose.yml exec -T api cat /data/first-run-setup-code

6. Complete six wizard stages: Company/Admin, Network/Database, Secure Setup, Agent Delivery, Integrations, Review/Finish. Administrator password must be at least 12 characters. SMTP and GitHub are optional.
7. After completion, sign in as the new administrator. Admin → System Settings offers editable company, host, branding, build mode, GitHub and SMTP settings.

## Security and recovery

- The initial setup code proves local host/volume access. Never commit it or paste it in logs.
- Secrets stored in /data persist across container restarts. Back up this persistent volume securely before upgrades or migrations; losing SETTINGS_ENCRYPTION_KEY loses access to encrypted SMTP/GitHub tokens.
- Production setup refuses to run while MySQL is disconnected. Owner creation and settings writes use a transaction with an advisory lock to prevent concurrent setup ownership claims.
- The admin configuration API requires SUPER_ADMIN and never returns plaintext passwords/tokens.
- Host GITHUB_TOKEN takes precedence over a UI-stored encrypted GitHub PAT. Agent API_TOKEN is not a GitHub PAT.
- Database credentials, TLS private keys, and server signing keys are host-managed; System Settings does not rewrite them.
- Changing the server host does not automatically reconnect existing Windows agents; plan controlled migration or re-enrollment.
- SMTP and remote server URL connection-test endpoints explicitly return NOT_IMPLEMENTED, not fabricated success.
- Only run first-time HTTP wizard on localhost, never over public HTTP. External access requires trusted HTTPS and hardening.

## Verification gate

Run npm ci, node --check on changed JavaScript, npm run test:unit, npm run test:integration, Docker Compose config, Windows PowerShell validation, repeated restart with persistent secrets, negative auth tests, and a clean-install workflow. Do not publish any endpoint MSI until genuine signed Windows installer lifecycle testing passes.

**Remaining release blockers:** all 21 tracked MSI artifacts are only 1536-byte fixtures; past CI PowerShell index step failed; existing agent authentication, command signatures, multi-tenant isolation, persistence and HTTPS/mTLS lifecycle still require separate remediation.
