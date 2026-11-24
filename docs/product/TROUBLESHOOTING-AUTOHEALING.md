# Troubleshooting, verified auto-healing and user-issue analytics — requirements

**Planning status:** New P1 feature family, **not already fully implemented**. Windows toolkit/collectors, command signing, command queue, alerts, tenant audit and measured telemetry supply reusable foundations. No arbitrary-script, elevated or destructive automation should be enabled by documentation alone.

## Product workflow

`Employee self-service ("I have a problem")` **and** `approved proactive detection` share one secure incident pipeline:

1. Intake: incident ID, installation/tenant/user/device, issue type, reproducibility, impact, user consent and minimal data.
2. Diagnose: execute read-only, time-bounded, signed/allowlisted collector with before-evidence and confidence; redact PII.
3. Decide: correlate policy, device permissions and repair tier. Report manual-only when root cause cannot safely be fixed by software.
4. Authorize: human/operator approval for any disruptive/privileged action; no bypass by model text, command argument or UI role.
5. Act: specific reviewed, signed, versioned action package, least-privilege execution, nonce/expiry, bounded retries and rollback when supported.
6. Verify: independent post-check and user feedback where needed; action ACK = **attempt**, not resolution.
7. Record: full audit and incident lifecycle including reopened cases, root-cause classification and measured time saved (estimate, not fact).

## Automation tiers

- **D0 observe:** read-only CPU/RAM/disk, network diagnostics, service status, event logs and safe configuration inspection; tenant policy and privacy still apply.
- **D1 low-risk**: narrowly scoped, reversible allowlisted action (e.g. approved temporary cache cleanup), only with advance user notice and organization-wide policy; never delete user files or terminate arbitrary processes.
- **D2 approval-required:** service restart, printer queue purge, OS repair, network reset, software/uninstall, driver rollback, startup/power/policy changes or reboot. Require device-owner consent and authorized admin approval, maintenance window and rollback/impact plan.
- **D3 human-only/emergency:** suspected active malware/ransomware, blue-screen with encryption/boot damage, burning smell/overheating, disk failure/data-loss risk, unsafe hardware. Block automatic risky repair and escalate with clear safety instructions.

**Never** defeat corporate DNS, firewall, Defender, audit/endpoint management, Microsoft security updates, VPN policy, encryption, sleep policy, or enterprise consent silently. No generic `Invoke-Expression`, arbitrary untrusted scripts or fleet-wide SYSTEM actions.

## Catalog: user-reported issue types

| ID | User issue / category | Allowed first diagnosis | Highest action policy | Success check |
|---|---|---|---|---|
| TR-01 | My PC is slow | Fresh CPU/RAM/disk, process pressure | D1/D2 | Measured resource relief + user confirms |
| TR-02 | WiFi connected but no internet | Gateway/DHCP/DNS, approved destination, captive portal | D2 | Approved LAN + destination connectivity restored |
| TR-03 | Windows Update won't install | Update/servicing logs, free space, error code | D2 | Exact failed KB installs and reports success |
| TR-04 | My disk is almost full | Volume consumption, SMART, approved cache inventory | D1/D2 | Free space improves without data loss |
| TR-05 | Blue screen of death | Event/stop code, safe dump metadata, hardware context | D3 | Human diagnoses; repeat crash absence verified over defined window |
| TR-06 | No sound from speakers | Audio endpoints, services, mute/output routing | D1/D2 | Audio test or user-confirmed sound returns |
| TR-07 | Bluetooth won't connect | Radio, service, pairing status/driver info | D2 | Intended device reconnects successfully |
| TR-08 | Printer won't print | Queue, spooler, network printer reachability | D2 | Test page confirmed by user/printer |
| TR-09 | Screen flickering or black screen | Display/driver/power/cable logs (when readable) | D2/D3 | Stable visible display with user validation |
| TR-10 | My PC takes forever to boot | Boot timing, startup footprint, event traces | D2 | Median measured startup time improves |
| TR-11 | I think my PC has a virus | Defender health, signature and alerts, read-only evidence | D3 | Security incident officially cleared, not merely scan finished |
| TR-12 | Outlook keeps crashing | Event logs, add-ins, safe application health | D2 | Outlook launches and stays usable |
| TR-13 | Start Menu or taskbar is frozen | Explorer/service health and event logs | D2 | Shell responds after approved repair |
| TR-14 | Laptop battery drains too fast | Capacity/wear, usage, power plan | D2 | Measured drain improves; hardware faults escalated |
| TR-15 | VPN connected but no internet | Route/DNS/split tunnel, VPN policy | D2 | Approved corporate and permitted internet destinations work |
| TR-16 | Windows Copilot won't turn off | OS edition, policy ownership/status | D2 | Policy-compliant setting confirmed; no policy bypass |
| TR-17 | Too many pre-installed apps | Installed apps, owner/admin allowlist | D2 | Approved apps removed, critical software untouched |
| TR-18 | Windows is sending too much data | OS telemetry settings and enterprise policy | D2 | Authorized policy state; no covert suppression |
| TR-19 | A driver update broke something | Update history, device manager, fallback driver | D2/D3 | Device functional on approved rollback |
| TR-20 | Right-click menu is annoying in Win11 | Build/version, shell options | D2 | User-preferred supported setting verified |
| TR-21 | PC is running on Power Saver | Current power plan/battery state | D2 | Approved plan effective; battery policy respected |
| TR-22 | Startup takes way too long | Startup and boot metrics | D2 | Post-change startup time improves |
| TR-23 | Microsoft Store apps won't open | App/service health, store cache error codes | D1/D2 | Targeted app opens and works |
| TR-24 | My computer smells like burning | **Do not probe/stress/reboot.** Stop use; safety instructions | D3 ONLY | Qualified technician clears physical hazard |
| TR-25 | My PC keeps going to sleep | Sleep timers, device management and power events | D2 | User-confirmed intended sleep policy works |
| TR-26 | Is my firewall working | Firewall profiles, rule service, agent posture | D0 (changes D2) | Approved firewall posture confirmed |

TR-10 and TR-22 intentionally remain separate user-phrasing IDs while sharing the same boot diagnostic playbook. WiFi/VPN diagnosis should use authorized enterprise gateways/test targets, **never** silently switch DNS to a public resolver. TR-24 requires stopping work and safe shutdown/disconnection only if safe; seek emergency/qualified assistance when necessary.

## Required data and audit model

`incident`: incident_id (UUID), installation_id, tenant_id, actor_user_id, device_id, intake_channel (SELF_SERVICE/PROACTIVE/TECHNICIAN), category_id, severity, consent/approval ids, opened_at, current_status, reopen links.

`attempt`: attempt_id, incident_id, playbook_id/version/digest, immutable signed command_id, approved_by/executed_by, precheck digest/summary, action response, postcheck digest/summary, bounded timestamps, rollback reference and outcome.

`outcome`: DIAGNOSED, NO_ACTION, WAITING_APPROVAL, ACTION_ATTEMPTED, VERIFIED_RESOLVED, USER_CONFIRMED, ESCALATED, UNRESOLVED, REOPENED, UNSAFE_BLOCKED. A queued/ACKed command can **never** self-report `VERIFIED_RESOLVED`. Never count duplicate retries as new incidents, and attribute resolution to AadiTech only when the specific attempted repair caused the verified post-condition.

Log errors, approvals, playbook digest, durations, aftercare/reopen windows and uncertainty. Redact secret material, private content and unnecessary process names; enforce tenant/installation boundaries, retention and access controls. No covert monitoring beyond user notice and organizational policy.

## Dashboard analytics definitions

- **Reported** = count distinct incident IDs created in interval.
- **Diagnosed** = incidents with qualifying diagnostic evidence.
- **Auto-fix attempted** = incidents with at least one automated repair *executed* (not just queued).
- **Verified auto-resolved** = distinct incidents with approved automated action + independent successful postcheck, excluding reopened/invalid outcomes under defined window.
- **Human-resolved** = separately verified technician-led cases; never double-count an incident in both mutually exclusive final categories.
- **Resolution rate** = verified auto-resolved / eligible reported incidents; publish denominator and exclusions. Cases that are inherently human-only should not inflate automation success.
- **Time saved** = transparent estimate based on documented manual baseline minus observed automation effort; never claim actual technician hours absent measured baseline.

Reports filter by installation, tenant, department, time, category, risk tier and actor role. Default data is aggregate; user-level details require least-privilege authorization and audit.

## Prerequisites and acceptance

1. Finish repeatable P0 intranet installation and installation identities first.
2. Implement policy engine, reviewed playbooks, staged approvals, rollback proofs, outcome verification and idempotent incident store.
3. Pilot D0 diagnostics and a small safe D1/D2 subset on lab endpoints, including false positives, disconnected clients and adversarial payloads.
4. Expand advanced cases only after expert sign-off and repeatable negative tests.

No current dashboard widget, `/api/v1/remediation/trigger` queue response, command ACK or `Remediate-<type>.ps1` string is proof that a repaired endpoint actually exists. Do not claim 26/26 issue classes auto-solved without each one's validated playbook and field test.

## Phase O parallel troubleshooting and setup progress foundation (2026-11-25 IST)

Exact prior head 2f01ffd8b56e087f08895d97e7ab2b8ad486a8e0: CI 45464297470 all four executable jobs passed including unsigned Windows MSI lifecycle; protected signing skipped. Deployment safety 45464297462 offline job passed, live MySQL job failed at startup socket ERROR 2002 before encrypted recovery ran. Do not claim encrypted restore acceptance.

Parallel batch: isolated MySQL rehearsal requires authenticated TCP connection to the final server (temporary initialization server uses skip-networking), bounded idempotent marker retries and final TCP probe before migration/seed; no retry of ambiguous non-idempotent writes. M4 now has executable advisory catalog TR-01..26 with conservative D3 escalation for physical hazards, malware, blue-screen, display and driver uncertainty; default-deny categorical consent/policy triage, no collector/repair authorization, outcome classifier refuses ACK-as-resolution; unit tests. M2 adds read-only redacted setup progress projection from actually verified independently pinned journal checkpoint, distinguishing RECORDED_COMPLETE, RECONCILIATION_REQUIRED and NOT_RECORDED; no paths, IDs, pins, execution or acceptance; tests including all stages recorded and stale checkpoint. Fresh combined CI and encrypted disposable recovery must pass.

M4 moves to IN_DEVELOPMENT as advisory reference only, not integrated product: persistent incident/attempt store, privacy-approved diagnostic adapters, authenticated consent and operator approval, signed playbooks, rollback, independent outcomes and field tests remain pending. DEC-005 remains blocked; conservative policy does not approve D1/D2 execution. M2 remains reference only; no browser endpoint, current anchor distribution, runtime/Windows ACL adapter or setup mutation. DEC-001/002/003/005 remain owner-gated. No protected signing, main merge or production acceptance.

## Phase O parallel incident persistence, signed setup display binding and restore continuity (2026-11-25 IST)

Exact head 8d33c0c1572e12225793614cd811388635c7523c: CI 45477940714 four executable jobs passed, including unsigned MSI lifecycle; protected signing skipped. Deployment safety 45477940884 both jobs passed; real job 138743032490 logs explicitly confirm authenticated AES-GCM disposable MySQL dump recovery and preserved credential revocation, receipt, usage snapshot and review reservation.

Parallel batch: migration 018 and baseline schema introduce internal technician categorical incident intake; authenticated caller and installation identity remain trusted-adapter prerequisites. Active current tenant SUPER_ADMIN and exact device scope locked in transaction, installation/tenant/actor/request idempotency, conflicting retries denied, one atomic audit, redacted own-record inspection, no free text, no employee endpoint, no consent/diagnosis/repair/verified resolution. Mock and actual concurrent MySQL regression included. Expanded encrypted isolated restore rehearsal preserves incident and intake uniqueness. Setup reference verifies short-lived (max 120s) Ed25519 display handoff evidence, independently pinned digest/key, installation/release/current checkpoint/challenge/session binding, canonical bytes and trusted clock; rechecks anchored journal before redacted display projection. No browser login, session authentication, challenge consumption, execution or setup mutation. Fresh combined CI required.

Conservative scope: M4 persists only minimal categorical internal technician intake and escalation, not employee/proactive workflows or attempt records. DEC-005 owner approval, retention/privacy and authenticated adapter remain required before exposure. Installation ID is supplied by trusted internal adapter, not proven by store. M2 remains a reference; independent signer/clock/challenge custody, one-use session handoff and runtime/Windows ACL adapter are pending. No live credential activation, main merge, production signing or acceptance.
