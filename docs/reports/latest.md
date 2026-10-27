# Phase 3, step 9: the app against the real API on the local Docker stack

Date: 2026-10-27. Branch `main`.

## Git

- Pushed earlier on Milan's OK: `8209b02`, `0227e33`, and the step 8 follow-up **`6ce2cf0`** (the step 8 follow-up report names it `9f1af80`, the hash before an amend; the correct one is `6ce2cf0`).
- This step: one commit (see `git log`), **not pushed**; it waits for Milan's OK.

## Setup (memory first, as asked)

- `C:\Users\shind\.wslconfig` (outside the repo, approved): `memory=4GB`, `swap=2GB`, `processors=4`, `autoMemoryReclaim=gradual`, `sparseVhd=true`; WSL and Docker restarted (Docker reports 4.1 GB).
- `kotlin.daemon.jvmargs=-Xmx1g` added to `apps/mobile/android/gradle.properties` (Gradle heap was already `-Xmx2048m`). That file is generated and git-ignored: `expo prebuild` regenerates it, so the line has to be added again after a prebuild. Emulator RAM is 2048 MB.
- One native build at a time, `gradlew --stop` after each; the real server and the mock API run as their own processes. The emulator was shut down once to free memory and started again.

## What runs

Postgres/PostGIS from `docker/compose.yaml`, migrated; the Fastify server on :3000 (`NODE_ENV=development`, `PAGE_SOURCE=fixtures`, `IMPORT_GAZETTEER=true`, a random `ADMIN_TOKEN` for the run: the one in `.env` is empty, which the config refuses); the debug build of the app on the emulator reaching it as `10.0.2.2:3000`.

The saved EDS pages are dated 22.10.2026, so everything would be in the past. New dev tools in `apps/server/src/dev/`:

- `pnpm --filter @struja/server dev:fixtures [--shift=<minutes>] [--repeat-today]`: copies the newest saved Niš snapshot to `.dev/eds/dev` (git-ignored) with the page dates moved to today..+3; `--shift` moves every time on the pages (so something is "now" at any hour); `--repeat-today` fills days 1..3 with day 0's content (the snapshot's days 1..3 have no in-scope outages).
- `pnpm --filter @struja/server dev:scrape`: queues one scrape for the running server.

With `--shift=240 --repeat-today` the database holds in-scope outages for today and the next three days; a second scrape with different hours was ingested as real changes (the earlier rows cancelled, the new ones "changed"), which also exercised the revision paths. Nothing requested elektrodistribucija.rs.

## Walkthrough on the emulator (real data)

Screenshots (git-ignored working set): `docs/screens/android/step9/`.

| Screen                  | Result                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start after a reinstall | Android restored the app's saved addresses; the app registered a new device and re-added them ("lost secret" flow) with no error                                                                                                                    |
| Add address: "Trebinj"  | finds Trebinjska (Palilula) in the real gazetteer; number 34, primary; saved (`POST /v1/subscriptions` 201)                                                                                                                                         |
| Početna                 | hero "Bez struje / U toku / Moguće", "Povratak za 2 h 3 min", amber dots on the next three days, tile "Struja se vraća 18:00", "Naredna 4 dana: 4" (the page says "parts of Trebinjska" without numbers, so house 34 is "Moguće pogođeno": correct) |
| Najave                  | grouped by day, "Vaša adresa" tag on the matching outage                                                                                                                                                                                            |
| Outage detail           | "U toku", window 13:00–18:00, "Vreme isključenja je izmenjeno.", timeline with the now marker, affected streets with "Pratite" / "Prati"                                                                                                            |
| Istorija                | empty state: no outage of these addresses has ended yet                                                                                                                                                                                             |

## Contract gaps found (and fixed)

New: `pnpm --filter @struja/mobile live-contract`, the app's own API client (every answer parsed with the shared zod schemas) against the real server: cities, gazetteer and 304, city browse with and without date, register on first use, add a street with number, `me/outages`, outage detail, a settlement, patch address and device, report, the limit of three, delete everything and the 401 after, error shapes. It runs only with `LIVE_API_URL` set (default in the script: `http://localhost:3000`); in `pnpm test` its 6 tests are skipped.

1. **Gazetteer revalidation never got a 304 (real bug).** The app sent the body's bare `etag` in `If-None-Match`; the server compares the quoted entity-tag, so every refresh downloaded the whole street list. Fix in `apps/mobile/src/api/endpoints.ts` (quotes it, never twice); regression tests in `__tests__/client.test.ts`; checked on the emulator (the app's request is now a 304). `docs/api.md` states it.
2. **Mock drift:** the mock answered 401 for an unknown route (the real server: 404 `not_found`); the mock's ETag header was the unquoted body value and its fixture `etag` carried quotes. Mock and its contract test now match the real server.

No other gap: every answer the real server gave parsed with the shared schemas.

## Gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · `pnpm test` green.
Tests: mobile **295** jest (+2) + 23 contract (+6 live ones that skip without `LIVE_API_URL`) · server 227 · parser 144 (+3 todo) · shared 22 · scripts 62.

## Left running / not done

- The local stack is still up (Docker Postgres, the server on :3000 with a random admin token, Metro, the emulator); stop it with `docker compose -f docker/compose.yaml down` and by closing the processes.
- The release build still points at `http://10.0.2.2:3000` unless `EXPO_PUBLIC_API_URL` is set at build time.
- Real push delivery (FCM) is Phase 4; the app registers with a development token, which the server accepts only with `NODE_ENV=development`.
- The `fail`-scenario screenshots wait for step 11 (as agreed).

## Decisions needed

1. OK to push this step's commit?
2. Keep `dev:fixtures` / `dev:scrape` / `live-contract` in the repo as shown (they are development-only and documented in `CLAUDE.md`)?
