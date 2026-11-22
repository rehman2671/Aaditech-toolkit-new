# Phase N Stage 72 — fail-closed frozen npm dependency installs in CI

## Finding

Both `.github/workflows/ci.yml` jobs `node-tests` and `api-tests` previously ran `npm ci || npm install`. An `npm ci` error (for example a lockfile mismatch or incomplete registry fetch) could be hidden by a successful normal `npm install`, changing the resolved dependency graph during security tests. This weakens reproducibility. An inspection of the preceding successful N71 Node CI log showed `npm ci` itself succeeded; this is **preventative hardening**, not an observed dependency compromise.

## Changes

- Replace fallback in both jobs with **exact `npm ci`**. Any lockfile mismatch or installation failure now fails that required job.
- Add `scripts/check-phase-n72-frozen-ci-dependencies.cjs`, included in `npm run lint`, to require frozen dependency install steps after repository checkout and Node setup, with no skipped/ignored failed install, altered working directory or non-frozen fallback.
- Compare committed `package.json` and `package-lock.json` root dependency specs/version against each other without modifying either.
- Add adversarial tests: fallback in either job, plain install, lockfile disabled, skipped/optional jobs/steps and changed root metadata.

## Acceptance

- [ ] N72 latest-head CI Windows/Node/Vitest/MySQL/API plus real unsigned Windows MSI integration successful.
- [ ] N72 latest-head safety workflow 2/2 successful.
- [ ] Independent reviewers and protected `main` branch, including #63 prerequisite, complete per [governance issue #62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62).
- [ ] Genuine signed MSI publication and Hostinger/customer deployment acceptance only after approved guarded main release.

N72 does not sign, publish, approve, deploy or modify production credentials. 
