# P0 installed worker UUID command/result lifecycle

Node issues UUID command IDs, while the old worker's INTEGER SQLite ledger could not represent them and queried an unsigned outer ID before verification. It also sent a hostname property rejected by the strict result schema.

The new separate TEXT UUID ledger retains the legacy integer ledger without inventing mappings. Signed verification precedes strict canonical UUID validation, SQLite atomic UNIQUE claim and execution. The terminal result is sanitized, bounded to 32768 characters and recorded before posting a strict status/output/exit_code body. A valid duplicate can resend saved terminal evidence; an uncertain prior claim must never re-execute or invent an ACK.

Source tests cover the contract; native function tests and actual SQLite concurrent/crash/recovery stress are necessary before release. The server does not yet guarantee redelivery of IN_PROGRESS commands, so durable ACK outbox/reconciliation remains pending. This proposal must be reconciled with PR #97 and reviewed independently before a protected merge. No signed MSI, real endpoint execution or production acceptance is claimed.
