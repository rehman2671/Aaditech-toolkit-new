# ADR-003: No Mock Telemetry & Zero Fake Production Data Enforcement

## Status
**ACCEPTED** (Mandatory Directive per Doc 1 Sec 1 & Doc 2 Sec A.3)

## Context
Standard AI coding agents often insert simulated/mock telemetry data (e.g., `Math.random()` CPU values or hardcoded dummy process lists) for quick demonstration. Doc 2 Section A.3 strictly forbids fake production data:
> *"Every metric, inventory item, and event surfaced by the platform must originate from a real collector reading an actual OS API, system interface, or validated library. This is a blocking rule, not a style preference."*

## Decision
We enforce a strict **No Mock Telemetry Policy** across the entire codebase architecture:

1. **Native System Collectors Only**:
   - Telemetry collectors for Windows, macOS, and Linux must interface directly with OS native APIs (WMI/CIM, sysfs, `/proc`, `gopsutil`, systemd, IOKit).
   - If an OS metric is unavailable or restricted by permissions, the agent reports an explicit status code (`UNAVAILABLE` or `PERMISSION_DENIED`) rather than generating synthetic fallback values.

2. **Server-Side Validation Engine**:
   - The ingestion server inspects incoming telemetry batches. Any payload lacking cryptographic device signature, sequence sequence number, or hardware timestamp validation is rejected.

3. **CI/CD Static Analysis & Linter Guard**:
   - CI pipeline includes automated code audits that flag `math/rand` usage in telemetry packages or simulated data routines.
