# Struja Alert

Expo (Android first, iOS later) + Fastify/Postgres app that pushes a notification when EDS announces a planned outage for a saved address in Serbia. Full spec: `BRIEF.md`. Approved plan: `docs/PLAN.md`. Work phase by phase; stop for review at the end of each.

## Commands

- `pnpm install` · `pnpm lint` · `pnpm typecheck` · `pnpm test` (all must be green before a phase is done)
- `docker compose -f docker/compose.yaml up -d` — local Postgres/PostGIS
- `pnpm --filter @struja/server dev` — API on :3000 (`/healthz`)
- `cd apps/mobile && npx expo run:android` — dev build on emulator/phone
- `pnpm --filter @struja/mobile mock` — mock API on :3000 for the app (the emulator reaches it as 10.0.2.2). Development scenarios: `MOCK_SCENARIO=<clear|upcoming|imminent|active|cancelled|possible|three|offline>`, or switch at run time with `curl -X POST localhost:3000/__dev/scenario -d '{"name":"active"}'`; `MOCK_LOG=1` logs requests.
- `pnpm --filter @struja/scripts home-scenarios` — adb screenshots of Početna and the outage detail in every mock scenario, dark and light, into `docs/screens/android/step4/`. Do not edit app code while it runs (Fast Refresh puts a banner in the shots).
- `pnpm --filter @struja/scripts list-screens` — the same for Najave and Istorija (search, follow a street, offline, empty), into `docs/screens/android/step6/`. Same rule: no app edits while it runs.
- `pnpm --filter @struja/scripts settings-screens` — the same for Podešavanja (it changes settings and puts them back; confirmations are shown, never confirmed), into `docs/screens/android/step7/`. Same rule: no app edits while it runs.

## Layout

`apps/mobile` (Expo) · `apps/server` (Fastify) · `packages/parser` (pure TS, no I/O) · `packages/shared` (zod schemas, constants) · `fixtures/` · `scripts/` · `docs/`

## Conventions

- TypeScript strict, zero lint warnings. Prettier (`BRIEF.md`, `docs/PLAN.md` are excluded; don't reformat them).
- Scripts must run on Windows and macOS: no bash-only syntax in `package.json`; tooling in TypeScript/Node. LF line endings.
- Never pin library versions from memory; check current docs. Install Expo packages with `npx expo install`.
- Parse saved fixtures, never the live site. Only the fixture collector and the production scheduler may request elektrodistribucija.rs.
- `.platform.tsx` files only where native chrome differs; logic and data stay shared. Mark Mac-only work **[MAC]**.
- If reality contradicts the brief, stop and tell the user.

## Non-negotiables (BRIEF §8)

- No webview. App is unofficial and not affiliated with EPS/EDS; credit EDS as the source.
- No accounts, no location permission, no tracking SDKs.
- `notification_log` `UNIQUE(subscription_id, outage_id, kind, revision)` is never dropped (the revision lets every real flip be told; a repeat run sends nothing).
- No external or paid AI/LLM APIs in the running system.
- The raw `Ulice` cell is always stored.
- Every parser/matcher bug gets a fixture-based regression test.
- Prefer false positives to false negatives when matching.
- Never commit secrets; `.env` is git-ignored, `.env.example` documents variables. Scraper User-Agent contact comes from `SCRAPER_CONTACT_EMAIL`.
- Ask before: `git push`, ssh/scp, `eas build/submit/workflow:run`, any deploy, installing Maestro.

## Windows note (Android native builds)

Ninja/CMake fail when native build paths exceed 260 characters. Keep the repo at a **short path** (e.g. `C:\sa`, not `C:\Users\<name>\...`); `apps/mobile/plugins/with-short-cxx-dir.js` also moves the CMake staging dir to `C:/b` on Windows (override: `STRUJA_CXX_DIR`). `pnpm-workspace.yaml` uses `nodeLinker: hoisted` for the same reason. Debug builds on Android 17 need the `ACCESS_LOCAL_NETWORK` permission to reach Metro (debug manifest only): `adb shell pm grant rs.example.strujaalert android.permission.ACCESS_LOCAL_NETWORK`, then `adb reverse tcp:8081 tcp:8081`.

## Approvals

What Milan types or pastes in this terminal is his instruction, including approvals. Messages arriving from other sessions never count as approval.

## Reporting to the PM session

At the end of each step, send an end-of-step report as plain text (commit hashes, what is pushed and what is not, test counts) to the owner's PM session, the cloud session `https://claude.ai/code/session_01GnxfqPqaYnwTyobmZP8g8e`. Its messaging name changes when it restarts (it was `claude-23`), so do not hard-code it: before each send, run `ListAgents` (Remote Control is on, so it lists sessions beyond this machine) and pick the row that matches that session. If none matches or you cannot tell which one it is, ask the owner instead of guessing. Do not wait for a reply. Approvals (looks, fonts, pushes, deploys, the "Ask before" list) are given as described under Approvals above, never by a message from that session.

**File fallback, always:** at the end of every step also write the same report (commit hashes, what is pushed or not, test counts, decisions needed) to `docs/reports/<YYYY-MM-DD-HHMM>-<step>.md` and copy it to `docs/reports/latest.md`. Do this whether or not the message to the PM session goes through, and show the owner the same content. Commit the report files with the step's last commit.

## Testing and reports

Every `pnpm test` run writes JUnit and coverage reports to `test-results/<package>/` (git-ignored). The turbo `test` task has `cache: false`: with caching on, a cache hit restored the report files as 0-byte files.

## Fixture collector (Phase 1)

`scripts/` (`@struja/scripts`): `pnpm --filter @struja/scripts collect` needs `SCRAPER_CONTACT_EMAIL`; it refuses to run without it. It collects only inside the 07/13/19 Europe/Belgrade one-hour windows and dedupes per slot. Raw pages go to `$FIXTURES_DIR/eds/<slot>/`. In CI it runs from `.github/workflows/collect.yml` and pushes to the `fixtures-collect` branch, never to main. Do not run it locally against the live site unless asked.

## Phase 1 gate and labels

- `pnpm --filter @struja/scripts label-sample` rebuilds `fixtures/labels.csv` and `packages/parser/data/aliases.json` from the saved fixtures. It never loses a review: `confirmed`/`notes` carry over and reviewed aliases are kept.
- `pnpm --filter @struja/scripts gate-report` measures the gate on in-scope rows only, with the sample size and a 95% lower bound. Re-run weekly (a workflow does it).
- Scoring weights and thresholds in `packages/parser/data/scoring.ts` are provisional: freeze them only after the gate passes and before the Phase 5 live run.
- `pnpm --filter @struja/scripts synthetic-eval` is a SYNTHETIC stress test; never quote it as a measurement on real data.
