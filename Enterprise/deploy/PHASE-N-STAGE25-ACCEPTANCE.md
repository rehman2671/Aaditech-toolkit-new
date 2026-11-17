# Phase N Stage 25 — Authentic device metrics and non-synthetic inventory

**Status: Code PR staged; CI pending. Production RELEASE BLOCKED.**

## Findings

- New device registration inserted simulated `12%` CPU, `38%` memory and `240 GB` free disk. Device SQL schema supplied fake `15%` CPU, `45%` memory, `250 GB` disk and `100% (AC)` battery even for never-connected agents. Device formatting and agent itself also guessed CPU/RAM/disk when Windows collectors failed.
- `/api/v1/devices/:id/processes` returned five fictitious Windows processes and `/api/v1/devices/:id/app-usage` returned four fictional app-usage rows until agent check-in. These looked like real tenant-device observations.
- Predictive analytics used fake CPU/RAM/disk fallback numbers, turned any flat/increasing free-space trend into positive disk consumption `0.01 GB/day`, and manufactured days-to-full. In HTML, `null < 14` evaluates `true` in JavaScript, so unknown predictions could enable remediation.

## Changes and semantics

- `012_measured_device_telemetry.sql` adds nullable `telemetry_reported_at` to devices. Historic usage values remain stored but **unverified** and hidden in tenant API projections. New SQL defaults for CPU/RAM/disk/battery and capacities become NULL. Telemetry history columns now distinguish measured zero from missing NULL, including latency.
- Only credential-verified device telemetry writes the server-owned evidence clock, never a supplied device timestamp. Partial snapshots clear absent metric fields instead of refreshing unmeasured legacy data; hard caps reject out-of-range or string values. A legitimate CPU 0%, disk 0 GB or RAM 0% is valid.
- Device/API projections mark telemetry `UNVERIFIED`, `AGENT_REPORTED` or `STALE` after 15 minutes. Battery remains NULL until the real collector reports it; a new registration has `registered` status, not a fake successful check-in.
- Windows agent sends NULL (unknown) for CPU, memory, disk, IP and network latency on collector failures; hardware inventory no longer invents RAM capacity, CPU model or Windows build number.
- Empty process/app-usage inventory returns `source:NOT_REPORTED` and `[]`, not demo activity. Predictive analytics requires five valid disk samples spanning at least 60 minutes, fresh last sample and authenticated current metric evidence. Flat/increasing free disk gets `NO_DEPLETION_TREND` and NULL days; no artificial consumption floor.
- Dashboard displays `Not reported` / `No valid forecast`; when days-to-depletion is NULL, cleanup cannot be offered due to JavaScript number coercion. Fleet health index explicitly marked heuristic (never compliance).
- Historic cached or stored telemetry may remain available for authorized forensic analysis, but it cannot be passed off as fresh evidence. Mobile/desktop consumers must handle nullable values and `INSUFFICIENT_DATA` statuses.

## Operational acceptance

- Must pass PR CI Node/Vitest/PowerShell, real MySQL/API and deployment-safety backup/restore, then merged main Windows MSI diagnostic rehearsal before closing **CODE/CI ACCEPTED**.
- Authenticode public signing, authorized live Hostinger DNS/TLS/VPS, production data offsite restore, real webhook/SMTP mailbox and physical managed Windows remain **BLOCKED**. Jira/Graph provider APIs are still **NOT_CONNECTED**.
