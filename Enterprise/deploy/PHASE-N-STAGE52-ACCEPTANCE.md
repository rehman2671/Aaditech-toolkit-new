# Phase N Stage 52 — Revalidate signed Windows HTTPS approval at every network boundary

**Status: CODE PROPOSED; PR CI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Finding

The N51 operator-only live Windows HTTPS health check verified an independently
pinned reviewer RSA signature, exact approved origin and two curl hashes once
before allocating a local workspace. Local curl provenance/Schannel inspection,
workspace setup, DNS resolution and the HTTPS transfer happen **after** that
verification. An approval manifest can expire or be replaced during these
steps; a one-time verification alone could permit a subsequent network
request or a misleading PASS after its authorization stopped being valid.

This does **not** mean the prior gate allowed an unsigned approval at the
initial check. N52 specifically hardens the **time between that check and
transfer/result publication**.

## Implementation

`Enterprise/deploy/Test-WindowsPinnedPublicHttps.ps1` now executes the
same N51 `Assert-PublicWindowsCurlSignedApproval` verification at four
separate boundaries:

1. **Initial authorization** after canonical endpoint/origin admission, before
   the workspace, curl and customer DNS.
2. **Pre-DNS** after workspace setup and trusted Windows system curl signer,
   binary and Schannel checks, before customer hostname lookup.
3. **Pre-transfer** after public-IP filtering and pinned curl argument
   preparation, immediately before invoking the native HTTPS GET.
4. **Post-transfer** after its exit code is captured and curl's executable hash
   is rechecked, before accepting the health result or recording PASS.

Each attempt reopens the bounded, local, non-reparse approval manifest,
detached signature and pinned reviewer DER certificate and verifies the signed
exact bytes and current validity. No cached boolean is used to authorize
later gates. Any disappearance, mutation, rejected signature or expired
approval returns the existing redacted `BLOCKED` result. The published
report cannot claim `certified_for_production=true`.

The original N42/N43 per-invocation consent, origin match, OS trust,
allowlisted public DNS, pinned `--resolve`, immutable evidence reporting and
workspace cleanup behavior is unchanged. The N31 unattended network probe
remains disallowed.

## Offline regression

`Enterprise/tests/Test-Stage52WindowsApprovalRecheck.ps1` verifies the
four gate locations in the actual operator script and uses a throwaway
RSA-2048 CI signing identity to demonstrate:

- a correctly signed and temporally valid synthetic approval passes
  successive checks;
- an on-disk edit **after** earlier approval is rejected before transfer;
- an authentic RSA-signed but **expired** synthetic approval fails closed;
- a corrupted signature after an earlier valid check fails closed;
- restored, still-valid bytes can be revalidated.

CI runs the test with real Windows PowerShell **5.1** and **7**, alongside
the N31–N51 baseline. No customer DNS, HTTPS transfer, reviewer private key
or real server approval is involved.

## Boundaries and sign-off

The check does not undo a request that has **already been sent** before
a later approval expires, nor does it defeat privileged same-host tampering,
in-memory code injection, or a compromised security-reviewer private key.
Expiry depends on the Windows system clock. A newly valid record separately
signed by the same approved reviewer could replace an old one during a run;
this safety gate checks authentic, current authorization, not nonce-based
single use or an external revocation registry.

- [ ] PR PowerShell 5.1/7 N52 regression plus N31–N51 safety tests green.
- [ ] PR Node/Vitest/MySQL, API/MySQL and deployment safety green.
- [ ] Review and merge the verified PR, then verify new `main` Windows
      EXE/MSI lifecycle (4/4) and deployment safety (2/2).
- [ ] **External production gates pending:** independently approved reviewer
      DER certificate fingerprint, physically reviewed exact customer origin,
      real signed approval, Hostinger DNS/TLS, publisher/HSM MSI signing,
      physical Windows ACK-loss queue replay and MySQL evidence, encrypted
      offsite restore, end-to-end integration and human security sign-off.

**Production NOT APPROVED.** Security tracking remains
[issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).
