# ADR-001: Service Topology Decision

## Status
**ACCEPTED** (Mandatory Architecture Decision Gate per Master Development Directive Doc 2 Section A.1)

## Context
The Aaditech Endpoint Monitoring & Management Platform contains several functional domains:
- Endpoint Inventory & Asset Management
- Ingestion Pipeline & Metrics Processing
- Alert Engine & Auto-Remediation
- MSI Package Builder Subsystem
- Remote Command Execution Engine
- Multi-Tenant Authentication & RBAC
- Immutable Audit Subsystem

A literal interpretation of these requirements might lead to over-engineering 10-15 independent microservices. However, at this phase, microservices introduce excessive operational complexity, deployment overhead, network latency, and distributed transaction issues.

## Decision
We adopt a **Modular Monolith + Asynchronous Background Worker Pool** pattern implemented in Go (`Golang`).

### Key Structural Properties:
1. **Single Compiled Binary**: The core backend compiles into a single performant Go binary (`aaditech-server`).
2. **Strict In-Process Domain Isolation**: Each domain resides in a dedicated package under `internal/` (e.g., `internal/devices`, `internal/ingest`, `internal/alerts`, `internal/msi`, `internal/commands`). Domains interact exclusively via Go interfaces and strictly typed DTOs.
3. **Decoupled Asynchronous Workers**: Heavy background tasks (metrics aggregation, alert evaluation, MSI compilation, notification dispatch) are handed off to an in-memory/Redis-backed job queue processed by a Go worker pool.
4. **Microservice-Ready Boundaries**: If scaling requires extracting a domain (e.g., the Ingestion Pipeline or MSI Package Generator) into an independent service in the future, it can be detached cleanly without rewriting domain logic.

## Consequences
### Positive:
- Simplified deployment (single Docker container / Cloud Run execution).
- High performance and low latency due to in-process function calls and Go's native goroutines.
- Clean maintainability and strict compile-time type checking across domains.

### Negative / Mitigation:
- All domains share database connection pools; mitigated by strict tenant schema isolation, connection limits, and domain-level query bounds.
