# Portal session and response boundary

## 2026-11-26 — MASS-11 portal response/session continuity

Six portal scripts now recheck the captured authentication token after asynchronous JSON decoding; configuration write uncertainty hides the stale edit panel, review/observation conflicts invalidate stale cards, consent and plan operations are mutually exclusive and consent/plan receipts are checked before confirmation. Hazard and observation projections reject inconsistent safety/authority fields. Exact retry IDs remain in page memory. No diagnostic execution, repair, production acceptance, owner decision or main merge is inferred. Focused VM race tests plus source guard tests are defined in `tests/unit/portal-session-response-boundaries.test.js`; fresh exact-head CI, real browser, SQL/HTTP and physical acceptance are pending. Rollback: revert this isolated batch commit on the candidate branch, retaining MASS-10 and prior requirements. No requirement parent is promoted.
