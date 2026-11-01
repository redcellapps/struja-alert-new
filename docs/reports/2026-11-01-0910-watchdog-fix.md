# Watchdog fix and the missing 31 Oct 07 slot (2026-11-01)

## Cause

`Watch the EDS collector` failed on 2026-10-31 and 2026-11-01. Scheduled runs pass `DATE: ${{ inputs.date }}`,
which is the empty string (the input exists only for manual runs). `collect-watch.ts` used
`process.env.DATE ?? dayToCheck(...)`; `??` keeps `""`, so the watchdog checked no day ("collected on (missing: -07, -13, -19)")
and exited 1. The issue step was skipped because the date output was empty, so only the failure mail went out.
Introduced with the watchdog in c21e70f. The collector itself was healthy.

## Fix

Commit `c455f2b` (pushed to main): `resolveDate()` treats a blank `DATE` as unset and falls back to yesterday;
regression test in `scripts/test/watch.test.ts`. Scripts tests: 68 passed; typecheck, prettier and root lint clean.

## Verified on GitHub

- Manual run with `date=2026-10-31` (run 41287280162): success, 2 of 3 slots (13, 19).
- Manual run without a date (run 41287282335): success; `DATE:` empty, it checked 2026-10-31 (yesterday).

## The 07 slot of 31 Oct

Belgrade was on CET (UTC+1), so the 07 slot window is 06:00Z to 12:00Z. `collect.yml` has runs at 05:16Z (skipped, slot 2026-10-30-19
already collected) and 12:08Z (already the 13 slot). Nothing was triggered in between: GitHub's scheduler fired no run for about
7 hours despite the hourly cron. This is the platform dropping scheduled runs (same behaviour as noted in `collect.yml`), not our code, so
nothing was changed. Two of three slots is accepted by the watchdog by design (MIN_SLOTS_PER_DAY = 2).
Decision for the owner, optional: add a second trigger (for example an external cron calling `workflow_dispatch`) if full 3-slot coverage matters.

## Pushed / not pushed

Pushed: `c455f2b`. Not pushed: this report commit and the uncommitted widget work.
