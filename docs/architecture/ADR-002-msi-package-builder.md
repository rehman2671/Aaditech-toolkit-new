# ADR-002: Secure MSI Package Builder Subsystem Architecture

## Status
**ACCEPTED** (Mandatory Subsystem Requirement per Doc 1 Sec 4 & Doc 2 Sec A.2)

## Context
The platform requires an automated MSI Package Builder that generates signed, tenant-customized Windows MSI installers for the endpoint agent. Per Master Directive Doc 2 Section A.2:
- The MSI Package Builder must NEVER be a static download link with hardcoded API keys.
- It must be a secure, first-class backend package-generation subsystem.
- Hardcoding permanent secrets into MSI files is strictly prohibited.

## Decision
We implement the MSI Package Builder as an isolated, security-hardened subsystem inside `internal/msi`.

### Key Architectural Specifications:
1. **Dynamic Short-Lived Enrollment Bootstrap Tokens**:
   - Installers do NOT contain permanent API keys or device credentials.
   - When an admin requests an MSI package, the backend issues an **Enrollment Bootstrap Token** signed with HMAC-SHA256, valid for a configurable window (e.g., 24-48 hours, single-use or scoped to a max device count).
   - Upon installation, the agent service uses this short-lived bootstrap token to contact `/api/v1/enroll`, complete mTLS identity handshake, receive its unique cryptographic device certificate, and store its persistent key pair in Windows DPAPI / Local Machine Cert Store.

2. **Isolated Build Pipeline**:
   - The Go backend utilizes a templated WiX toolset definition (`Agent.wxs`) combined with a dynamic configuration payload (`agent.json`).
   - The build process executes in an isolated workspace with resource limits and execution timeouts.

3. **KMS / Code Signing Protection**:
   - Generated MSI binaries are digitally signed using an Authenticode code-signing certificate stored in an HSM or encrypted local keystore.
   - Every generated package is hashed (SHA-256) and tracked in the `msi_packages` table with metadata (Package ID, Creator, Tenant ID, Scoped Group, Token Expiry, Revocation Status).

4. **Secure Download Authorization & Audit**:
   - MSI downloads require authenticated JWT sessions with `msi:generate` or `msi:download` RBAC permissions.
   - All package creation and download events write an immutable record to `audit_logs`.
