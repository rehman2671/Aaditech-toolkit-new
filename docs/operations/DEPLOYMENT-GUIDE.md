# Enterprise Deployment & Operations Guide

---

## 1. Prerequisites & Hosting Environment

- **Runtime:** Node.js v20.x LTS or higher
- **Database:** MySQL 8.0+ or MariaDB 10.11+ (with InnoDB engine and Range Partitioning support)
- **Cache / Distributed Coordination:** Redis 6.2+
- **Reverse Proxy:** Caddy or Nginx with TLS 1.3 termination
- **Process Manager:** PM2 (Cluster mode or pm2-runtime)

---

## 2. Environment Configuration

Copy `.env.example` to `.env` outside version control and populate secure cryptographically random secrets:
```bash
cp .env.example .env
chmod 600 .env
```

Required Production Secrets:
- `JWT_SECRET`: 64+ char random string
- `HMAC_SECRET`: 64+ char random string
- `BOOTSTRAP_SECRET`: 64+ char random string
- `COMMAND_SIGNING_KEY`: 64+ char random string
- `API_TOKEN`: 64+ char random string

---

## 3. Database Initialization & Migrations

Execute the automated migration runner:
```bash
node test-migrations-runner.js
```
The runner applies `001_init_schema.sql`, `002_partitioning.sql`, and `003_rbac_and_audit.sql` idempotently.

---

## 4. Starting the Server

### Development:
```bash
npm run dev
```

### Production (PM2 Cluster):
```bash
npm run start:cluster
```
Probe healthz endpoint:
```bash
curl -f http://127.0.0.1:3000/healthz
```
