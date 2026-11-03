# Architecture Specification: Canonical Agent Protocol (CAP-v1)

**Status:** APPROVED & AUTHORITATIVE  
**Version:** 1.1.2  
**Standard Prefix:** `/api/v1`  
**Compatibility Alias:** `/api`  

---

## 1. Architectural Decision Record: Canonical Agent Selection

### Decision
The authoritative Windows endpoint agent architecture is **`Enterprise/agent/Agent-Collect.ps1`** packaged as **`IT-Toolkit-Agent.exe`** via ps2exe and installed via WiX MSI.

### Rationale
1. **Least-Privilege Security Model:** `Agent-Collect.ps1` separates routine background collection (executed as `NETWORK SERVICE`) from privileged operations (handled via scheduled task handoff `ITToolkitAgentElevated` running as `SYSTEM`).
2. **Modular Architecture:** Utilizes discrete collector modules (`Enterprise/agent/collectors/`) with strict data sanitization (`SanitizeEngine.psm1`).
3. **Resilience & Offline Queue:** Built-in persistent local queue (`queue.sqlite3`) with exponential backoff and jitter prevents data loss during network disruptions.
4. **Syntax & AST Compliance:** Conforms strictly to Windows PowerShell 5.1 and PowerShell Core AST parsers.

`Aaditech-Agent.ps1` is retained as a standalone portable diagnostics script for direct operator execution, with its parser syntax remediated.

---

## 2. Protocol Lifecycle & Contract

### 2.1 Device Enrollment & Token Issuance
- **Method & Route:** `POST /api/v1/agent/enroll` (or `/api/agent/enroll`)
- **Headers:** `Content-Type: application/json`
- **Request Envelope:**
```json
{
  "bootstrap_token": "<single-use-hmac-token>",
  "hostname": "WIN-SRV-01",
  "device_uid": "dev-uid-win-srv-01",
  "os_version": "Windows 11 Enterprise 23H2",
  "agent_version": "1.1.2",
  "mac_address": "00:15:5D:01:AF:22"
}
```
- **Response (200 OK):**
```json
{
  "status": "ENROLLED",
  "device_id": "3d90ba55-ebc0-4c3d-a852-c552eed977d9",
  "device_token": "itk_dev_<64_char_crypto_hex>",
  "heartbeat_interval_seconds": 60,
  "telemetry_interval_minutes": 30
}
```
- **Security Invariant:** Bootstrap tokens are single-use, bounded to a tenant ID, and expire after a configurable duration. Newly issued device tokens are hashed with SHA-256 and stored in MySQL `devices.device_token_hash`.

### 2.2 Device Authentication (Every Request)
Every non-enrollment request must supply device credentials via either:
1. **Per-Device Token Header:**
   `X-Device-Token: itk_dev_<64_char_crypto_hex>`
2. **HMAC-SHA256 Payload Signature:**
   `X-Device-UID: dev-uid-win-srv-01`
   `X-Timestamp: <unix_epoch_ms>`
   `X-Agent-Signature: <hmac_sha256(COMMAND_SIGNING_KEY, device_uid + ":" + timestamp)>`

### 2.3 Heartbeat
- **Method & Route:** `POST /api/v1/heartbeat` (or `/api/heartbeat`)
- **Headers:** `X-Device-Token: <token>`
- **Response (200 OK):** Updates `last_seen` timestamp and returns `status: "ok"`.

### 2.4 Telemetry Ingestion
- **Method & Route:** `POST /api/v1/ingest/telemetry` (or `/api/ingest`)
- **Headers:** `X-Device-Token: <token>`, `Content-Type: application/json`
- **Schema:**
```json
{
  "hostname": "WIN-SRV-01",
  "os_version": "Windows 11 Enterprise",
  "agent_version": "1.1.2",
  "ip_address": "192.168.1.100",
  "metrics": {
    "cpu": { "utilization_pct": 24.5 },
    "ram": { "utilization_pct": 58.2, "free_mb": 6840 },
    "disk": { "free_gb": 182, "total_gb": 512 }
  },
  "processes": [
    { "pid": 1024, "name": "spoolsv.exe", "cpu_pct": 0.2, "ram_mb": 42.1, "path": "C:\\Windows\\System32\\spoolsv.exe" }
  ],
  "posture": {
    "firewall_status": "ENABLED",
    "antivirus_name": "Windows Defender",
    "antivirus_status": "ACTIVE",
    "bitlocker_status": "PROTECTED"
  }
}
```

### 2.5 Command Polling & Execution Result
- **Polling Route:** `GET /api/v1/commands/poll?device_id=<device_id>`
- **Status Lifecycle:** `PENDING` -> `CLAIMED` -> `RUNNING` -> `COMPLETED` | `FAILED`
- **Result Route:** `POST /api/v1/commands/:id/result`
```json
{
  "status": "COMPLETED",
  "exit_code": 0,
  "stdout": "Service Print Spooler restarted successfully.",
  "stderr": ""
}
```

### 2.6 Agent Update & Health Verification
- **Artifact Route:** `GET /api/v1/agent/update/check` -> returns available version, SHA-256 hash, and download URL (`/api/v1/msi/download/:id`).
