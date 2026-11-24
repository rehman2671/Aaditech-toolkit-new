# Phase O — Master integration reconciliation

Observation: 2026-11-24. Main 911f509620029c513305c88b26ca0da4e1b7da37 is unprotected and rulesets empty. #108 latest exact head f88143083f4d9de8d980aaf215990e281d1218cd (CI 45390061413 and deployment safety 45390061331 SUCCESS) is the selected code base; #77 c6eafa1f13ad0998fc0572cf6c0daa26e59f1462 supplies current product baseline; #75 67abb1bff711a400b55b3f695311917a7d3069c9 supplies governance pagination hardening. Checked 33 open PRs. Compare each PR changed-file blob against #108; exact matches are evidence of identical bytes, changed paths are not proof of equivalent behavior. #77 (26 paths) and #75 (6 paths) are non-overlapping with #108 changes relative to main and each other; imported as exact blobs except deliberate documentation reconciliation below. The source #108 includes the independently pinned checkpoint verifier. Fresh combined CI and independent review required. This is a review candidate, not a release.

| PR | Changed paths | Exact in #108 | Proposed disposition |
|---:|---:|---:|---|
| [#108](https://github.com/rehman2671/Aaditech-toolkit-new/pull/108) | 95 | 95 | BASE |
| [#107](https://github.com/rehman2671/Aaditech-toolkit-new/pull/107) | 89 | 88 | SUCCESSOR |
| [#106](https://github.com/rehman2671/Aaditech-toolkit-new/pull/106) | 83 | 81 | SUCCESSOR |
| [#105](https://github.com/rehman2671/Aaditech-toolkit-new/pull/105) | 70 | 69 | SUCCESSOR |
| [#104](https://github.com/rehman2671/Aaditech-toolkit-new/pull/104) | 7 | 6 | SUCCESSOR |
| [#103](https://github.com/rehman2671/Aaditech-toolkit-new/pull/103) | 4 | 4 | EXACT |
| [#102](https://github.com/rehman2671/Aaditech-toolkit-new/pull/102) | 68 | 66 | SUCCESSOR |
| [#101](https://github.com/rehman2671/Aaditech-toolkit-new/pull/101) | 30 | 25 | SUCCESSOR |
| [#100](https://github.com/rehman2671/Aaditech-toolkit-new/pull/100) | 5 | 2 | SUCCESSOR |
| [#99](https://github.com/rehman2671/Aaditech-toolkit-new/pull/99) | 25 | 18 | SUCCESSOR |
| [#98](https://github.com/rehman2671/Aaditech-toolkit-new/pull/98) | 5 | 1 | SUCCESSOR |
| [#97](https://github.com/rehman2671/Aaditech-toolkit-new/pull/97) | 11 | 8 | SUCCESSOR |
| [#96](https://github.com/rehman2671/Aaditech-toolkit-new/pull/96) | 5 | 4 | SUCCESSOR |
| [#95](https://github.com/rehman2671/Aaditech-toolkit-new/pull/95) | 6 | 4 | SUCCESSOR |
| [#94](https://github.com/rehman2671/Aaditech-toolkit-new/pull/94) | 5 | 4 | SUCCESSOR |
| [#93](https://github.com/rehman2671/Aaditech-toolkit-new/pull/93) | 20 | 17 | SUCCESSOR |
| [#92](https://github.com/rehman2671/Aaditech-toolkit-new/pull/92) | 7 | 5 | SUCCESSOR |
| [#91](https://github.com/rehman2671/Aaditech-toolkit-new/pull/91) | 5 | 2 | SUCCESSOR |
| [#90](https://github.com/rehman2671/Aaditech-toolkit-new/pull/90) | 4 | 3 | SUCCESSOR |
| [#89](https://github.com/rehman2671/Aaditech-toolkit-new/pull/89) | 3 | 2 | SUCCESSOR |
| [#88](https://github.com/rehman2671/Aaditech-toolkit-new/pull/88) | 3 | 2 | SUCCESSOR |
| [#86](https://github.com/rehman2671/Aaditech-toolkit-new/pull/86) | 3 | 2 | SUCCESSOR |
| [#85](https://github.com/rehman2671/Aaditech-toolkit-new/pull/85) | 11 | 9 | SUCCESSOR |
| [#84](https://github.com/rehman2671/Aaditech-toolkit-new/pull/84) | 2 | 1 | SUCCESSOR |
| [#82](https://github.com/rehman2671/Aaditech-toolkit-new/pull/82) | 2 | 2 | EXACT |
| [#81](https://github.com/rehman2671/Aaditech-toolkit-new/pull/81) | 5 | 3 | SUCCESSOR |
| [#77](https://github.com/rehman2671/Aaditech-toolkit-new/pull/77) | 26 | 0 | IMPORT |
| [#76](https://github.com/rehman2671/Aaditech-toolkit-new/pull/76) | 5 | 4 | SUCCESSOR |
| [#75](https://github.com/rehman2671/Aaditech-toolkit-new/pull/75) | 6 | 0 | IMPORT |
| [#61](https://github.com/rehman2671/Aaditech-toolkit-new/pull/61) | 46 | 1 | HISTORICAL_REVIEW |
| [#4](https://github.com/rehman2671/Aaditech-toolkit-new/pull/4) | 13 | 0 | HISTORICAL_REVIEW |
| [#3](https://github.com/rehman2671/Aaditech-toolkit-new/pull/3) | 15 | 0 | HISTORICAL_REVIEW |
| [#2](https://github.com/rehman2671/Aaditech-toolkit-new/pull/2) | 24 | 0 | HISTORICAL_REVIEW |

BASE: selected code tree. EXACT: all PR changed blobs match. SUCCESSOR: all differing paths have changes in the candidate, often later combined changes; verify semantic retention and selected alternative before closing. IMPORT: non-overlapping source files added to candidate. HISTORICAL_REVIEW: deliberately not merged; inspect original-base patch and compare against current runtime. No source PR closed or merged. No implied independent approval.

## Historical residual review

- #61 N64–N74 draft is based on older implementation. Its complete tree differs from current main on 74 paths including removal of newer compiler-continuity, archive safety, WiX continuity, release configuration, live-main governance and strict VPS gates. Do not copy its full tree or publish workflow. Review its 46 PR patch paths for still-needed immutable action pins, diagnostics and signer admission. #75 and #76 are the current narrow changes; do not claim #61 fully covered.
- #2/#3/#4 are old stacked drafts against different bases; their actual PR patch sizes are 24/15/13 files. Whole historical trees differ from current main on 337/341/345 paths respectively. Do not restore older server.js, db.js, Agent-Collect.ps1, WiX, workflows or migrations. Audit original tenant isolation, per-device trust, unsafe elevation retirement and MSI lifecycle requirements against current code and tests; transplant only verified missing controls with fresh regression evidence.
- #81/#84/#82 alternative UI/build changes selected via #85, then #102. #95–#100 via #101/#102. #88–#94 via #93/#102. #103–#108 layered LAN/identity/reference preflights. Exact blob counts and candidate modifications do not prove all semantic equivalence.

## Architecture freeze proposal (not owner ADR)

Recommend DEC-001A: formally retain existing Node.js/Express + MySQL 8 for first supported LAN release, conditional on explicit owner approval amending original Go/PostgreSQL stack lock. Modular API/worker deployment, approved Linux runtime (Windows Server host via reviewed VM model or later native adapter, not assumed supported), local private HTTPS, persistent identity, signed offline package, browser bootstrap and reconfiguration. Preserve APIs, data ownership and full original scope; no migration merely to satisfy an unapproved architecture choice. If DEC-001B selected, develop a separate Go/PostgreSQL migration and parity/rollback plan first. See STACK-DECISION-DOSSIER.md and owner decision packet. No final stack freeze asserted.

## Execution gates

O1: independent review of selected source and residual semantic gaps, fresh combined CI, protected main configuration and real non-bypass rule verification (#62). O2: owner DEC-001A/B and OS/runtime scope approval, no silent stack change. O3: integrate reference preflights into actual locked, persistent installer/runtime and authenticated browser bootstrap. O4: build complete pinned signed offline payload and pilot in isolated WAN-disconnected environment, two physical Windows clients, telemetry/commands/reconnect/tenant boundaries. O5: encrypted DB-consistent backup/restore, certificate rotation, interruption/reconfigure/upgrade and rollback with independent evidence. O6: implement phased troubleshooting and controlled remediation against real telemetry; signed release and acceptance remain separate. No production deployment, signing or merge without authorized evidence.

Review focus: `server.js`, `db.js`, `Enterprise/agent/Agent-Collect.ps1`, `Enterprise/portal/index.html`, `.github/workflows/ci.yml`, agent packaging, publisher workflow and selected historical residuals. Use machine-readable PHASE-O-PR-RECONCILIATION.json for the observation snapshot; re-run on source changes.
