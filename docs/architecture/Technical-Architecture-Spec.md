# Technical Architecture Specification
## Aaditech Endpoint Monitoring & Management Platform

**Document Version:** 1.0.0  
**Implementation Stack:** Go (Golang 1.22+) Backend, PostgreSQL 16 + TimescaleDB Partitioning, Redis 7+ Queue, REST / JSON & Protocol Buffers Ingestion API, React / Tailwind Dashboard.

---

## 1. System Architecture
The platform follows an **Enterprise Edge-to-Cloud Monitoring Architecture**:

```
+-----------------------------------------------------------------------------------+
|                                  ENDPOINT AGENTS                                  |
|  +--------------------+      +--------------------+      +--------------------+  |
|  |   Windows Agent    |      |    macOS Agent     |      |    Linux Agent     |  |
|  |  (Service + WMI)   |      |  (Daemon + sysctl) |      | (Daemon + /proc)   |  |
|  +---------+----------+      +---------+----------+      +---------+----------+  |
+------------|---------------------------|---------------------------|--------------+
             | mTLS / TLS 1.3            | mTLS / TLS 1.3            | mTLS / TLS 1.3
             v                           v                           v
+-----------------------------------------------------------------------------------+
|                           INGESTION & API LAYER (GO)                              |
|  +-----------------------------------------------------------------------------+  |
|  |                         `aaditech-server` Monolith                          |  |
|  |  +------------------+   +-------------------+   +------------------------+  |  |
|  |  |  Ingest Gateway  |   |  REST API & Auth  |   | MSI Package Subsystem  |  |  |
|  |  +--------+---------+   +---------+---------+   +-----------+------------+  |  |
|  +-----------|-----------------------|-------------------------|----------------+  |
+--------------|-----------------------|-------------------------|------------------+
               |                       |                         |
               v                       v                         v
+-----------------------------------------------------------------------------------+
|                            STORAGE & WORKER LAYER                                 |
|  +------------------------+  +----------------------+  +-----------------------+  |
|  |   Redis Queue / PubSub |  | PostgreSQL 16 (Rel)  |  | Partitioned Metrics   |  |
|  |   & Worker Pool (Go)   |  |  & Multi-Tenant DB   |  | (Time-Series Hyper)   |  |
|  +------------------------+  +----------------------+  +-----------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Technology Stack Selection Matrix

| Subsystem | Technology Selected | Version | Justification |
|---|---|---|---|
| **Backend Runtime** | Go (Golang) | 1.22+ | Compiled binary, low RAM footprint, native concurrency (goroutines), strict type safety. |
| **HTTP Framework** | Chi / standard `net/http` | v5 | Lightweight, 100% standard library compatible, fast routing, zero allocation overhead. |
| **Relational DB** | PostgreSQL | 16+ | Enterprise multi-tenancy, JSONB support, strict ACID, row-level security (RLS). |
| **Time-Series Storage** | TimescaleDB / PG Partman | 2.14+ | Automatic time-partitioning on `device_metrics`, compression policies, fast range scans. |
| **Queue & Cache** | Redis | 7.2+ | In-memory queue for telemetry ingestion backpressure and rate limiting. |
| **Migration Engine** | `golang-migrate` | v4 | Deterministic SQL schema versioning. |
| **Agent Packaging** | WiX Toolset / Go MSI Generator | v3.14/v4 | Enterprise-grade signed Windows MSI package generation. |

---

## 3. Database Schema (PostgreSQL 16)

### Core DDL Definitions

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenants Table
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users & RBAC
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATOR', 'VIEWER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Registered Devices Inventory
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    hostname VARCHAR(255) NOT NULL,
    device_uid VARCHAR(128) UNIQUE NOT NULL,
    os_type VARCHAR(32) NOT NULL CHECK (os_type IN ('WINDOWS', 'MACOS', 'LINUX')),
    os_version VARCHAR(128) NOT NULL,
    os_build VARCHAR(128),
    arch VARCHAR(32) NOT NULL,
    agent_version VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'OFFLINE', 'DECOMMISSIONED')),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hardware Inventory
CREATE TABLE device_hardware (
    device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    cpu_model VARCHAR(255),
    cpu_cores INT,
    cpu_threads INT,
    total_ram_bytes BIGINT,
    motherboard_serial VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Time-Series Telemetry Metrics (Partitioned by Month)
CREATE TABLE device_metrics (
    recorded_at TIMESTAMPTZ NOT NULL,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    cpu_utilization_pct REAL NOT NULL,
    ram_used_bytes BIGINT NOT NULL,
    ram_utilization_pct REAL NOT NULL,
    disk_read_bytes_sec BIGINT DEFAULT 0,
    disk_write_bytes_sec BIGINT DEFAULT 0,
    net_bytes_sent_sec BIGINT DEFAULT 0,
    net_bytes_recv_sec BIGINT DEFAULT 0,
    PRIMARY KEY (device_id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Partition Examples
CREATE TABLE device_metrics_2026_08 PARTITION OF device_metrics
    FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');

-- MSI Package Generation Audit Table
CREATE TABLE msi_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    package_name VARCHAR(255) NOT NULL,
    version VARCHAR(32) NOT NULL,
    bootstrap_token_hash VARCHAR(255) NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    created_by UUID REFERENCES users(id),
    file_path VARCHAR(512) NOT NULL,
    file_hash_sha256 VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Remote Commands Executions
CREATE TABLE remote_commands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    command_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'SUCCESS', 'FAILED', 'EXPIRED')),
    result_output TEXT,
    signature VARCHAR(512) NOT NULL,
    issued_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

-- Immutable Audit Log
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    actor_email VARCHAR(255) NOT NULL,
    action VARCHAR(128) NOT NULL,
    target_resource VARCHAR(128) NOT NULL,
    details JSONB,
    client_ip VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 4. Agent ↔ Server Communication Protocol

### Ingestion Protocol
Agents post telemetry payloads to `/api/v1/ingest/telemetry` at regular configurable check-in intervals (e.g. 60 seconds).

**Request Header Requirement:**
- `Authorization: Bearer <device_session_jwt_or_cert>`
- `X-Agent-Version: 1.1.2`
- `X-Device-UID: win-agent-990a82`
- `Content-Type: application/json`

**Sample Real Telemetry Payload:**
```json
{
  "device_uid": "win-agent-990a82",
  "timestamp": "2026-08-12T20:25:00Z",
  "sequence_number": 1042,
  "metrics": {
    "cpu": { "utilization_pct": 14.2 },
    "ram": { "total_bytes": 17179869184, "used_bytes": 8589934592, "utilization_pct": 50.0 },
    "disks": [
      { "drive_letter": "C:", "total_bytes": 512000000000, "used_bytes": 256000000000, "read_bytes_sec": 1024, "write_bytes_sec": 4096 }
    ],
    "network": [
      { "interface": "Ethernet", "bytes_sent_sec": 5120, "bytes_recv_sec": 20480 }
    ]
  },
  "security_posture": {
    "antivirus_active": true,
    "firewall_enabled": true,
    "bitlocker_status": "PROTECTED"
  }
}
```

---

## 5. Security & Enrollment Model
1. **Bootstrap Token Generation**: Admin creates an MSI via `/api/v1/msi/generate`. A short-lived, single-use bootstrap token (`bootstrap_expires_at: +24h`) is attached to the installer configuration.
2. **Device Handshake**: Upon first execution, the agent posts its Hardware GUID + Bootstrap Token to `/api/v1/enroll`.
3. **Identity Verification**: The backend validates the bootstrap token, registers the device in `devices`, and issues an individual device mTLS Certificate / RSA Keypair.
4. **Token Revocation & Security Watchdog**: If an agent is marked `DECOMMISSIONED`, its token and device cert are immediately added to the Revocation List (`CRL`).
