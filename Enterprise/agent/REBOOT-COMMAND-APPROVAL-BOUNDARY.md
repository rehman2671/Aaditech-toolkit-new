# P0: Windows signed reboot must remain blocked until owner approval exists

A valid enrolled-device HMAC is **not** permission to interrupt a live PC. The old installed `Agent-Collect.ps1` could process a remote `reboot` command immediately under elevated privilege or stage `elevated-job.json` for an on-demand SYSTEM task. The staged file had no independent, human-approved maintenance-window/consent proof, and non-elevated signed reboot could previously return `status=completed` merely because the operation was staged.

This PR intentionally **disables all automatic reboot execution** in the installed worker. Signed `reboot` returns `failed`, code **403** with `REBOOT_APPROVAL_REQUIRED` and explicitly says no reboot ran. `Request-ElevatedJob -Action reboot` refuses before file writes; elevated pass ignores any old staged reboot instead of executing it. No shutdown/Restart-Computer commands remain. Ordinary telemetry/diagnostics and signed-command verification remain unchanged. A queued/reported failure is not a resolved incident.

Native Windows `Enterprise/tests/Test-RebootDefaultDeny.ps1` parses the worker, isolates `Invoke-RemoteCommand`, stubs SYSTEM delegation to throw, and checks delay variants never reboot or return success. Node contract `tests/unit/reboot-default-deny.test.js` guards both privileged and command branches.

To restore future operator-approved reboot safely: design authenticated user/device-owner consent, explicit per-device maintenance window, authorization bound to signed command ID/action/expiry, rollback/impact and result/post-check evidence, and code reviewed privileged IPC inaccessible to a tenant/session/token writer. No unsafe quick toggle is provided. Signed MSI [#62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62), LAN installer [#80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80), architecture ADR [#79](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79) remain release blockers.

## API and portal admission gate

The command dispatch validation now refuses `reboot` (case/whitespace insensitive) in either `kind` or `command_type` **before** queueing; normal authorized wake/allowlisted-script requests are not broadly removed. Portal commands no longer offer reboot as an enabled selection, explain the consent limitation and have a guard against manually selecting a stale reboot kind. This is defense-in-depth to accompany worker and elevated-pass denial, not a consent engine. PR #85 also changes portal UI; independent reviewer must reconcile those diffs before merging.
