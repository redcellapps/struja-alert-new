# Phase 2 plan: backend

Builds on `docs/PLAN.md` §6 and the approved additions. Each step ends with tests green and a commit; the phase ends with a summary and a stop for review.

## Architecture decision (deviation from BRIEF §3, flagged)

The brief resolves street names with `pg_trgm` (step 3) and PostGIS (step 5) inside Postgres. Phase 1 already built and measured the whole ladder as pure TypeScript in `packages/parser` (`Resolver`): it runs over the ~2,250 Niš streets in milliseconds and is the same code the app can share. So the server **loads the gazetteer from Postgres into that in-memory `Resolver`** (at startup and after alias changes) instead of re-implementing the ladder in SQL. Postgres remains the system of record (PostGIS geometry, `pg_trgm` index for admin search). Reversible: the resolver has a small interface.

The scoring weights and thresholds are **provisional** until the Phase 1 gate passes (user decision); Phase 2 uses them as they are.

## Steps

1. **Schema + migrations** (done): Drizzle schema for every table of BRIEF §4 plus `settlement`, `gazetteer_version`; migration 0000 creates `postgis`/`pg_trgm`; integration tests on a real PostGIS container (Testcontainers). The `notification_log` dedupe constraint is tested.
2. **Gazetteer in the database** (done): imports the OSM snapshots (streets, settlements, address points, reviewed aliases) keeping street ids stable; loads them back into a `Resolver`; `GET /v1/cities`, `GET /v1/cities/:city/gazetteer` with an ETag.
3. **Ingestion** (done): fetch → hash → parse → split → resolve → persist (`outage`, `outage_street`, identity key, in-scope flag, `scrape_run`); replaying the saved fixtures produces the expected rows; unresolved segments keep their top-5 candidates.
4. **Change and cancellation detection** (done): pairing of replaced rows (changed time by identity; edited street list by municipality + date + time window + overlapping streets; smallest-shift pairing; ties become a change group, never a guess); a replaced row that returns is a revert; "missing for two consecutive fetches, not yet started" cancels.
5. **Matcher and notifications** (done, with a fake push provider; real push is Phase 4): subscription matcher (house ranges, parity, `бб`, partial, settlements); copy in sr-Latn (source), sr-Cyrl (generated) and en; quiet hours and the 2-hour urgent rule; the outbox in `notification_log` (claim, deliver, retry, receipts, dead tokens); evening-before; the 12-hour safety net. Rules (user, 22 Oct): a changed outage sends only "Izmena" to people already notified, never also "new"; a street-list edit notifies only the difference; ambiguous changes send one "Izmena" listing the new windows; a revert is another "Izmena", not a cancellation.
6. **Jobs** (done): pg-boss on Europe/Belgrade: scrape 07/13/19, plan, evening reminder 19:15, deliver, receipts, outage start/end signals (a sink interface; the real data push is Phase 4), hourly safety net, nightly `pg_dump` with 14-day retention. No live scraping during development: the page source is the saved fixtures; the HTTP source (identified, paced, conditional) is for the production scheduler only.
7. **API `/v1`** (done, `docs/api.md`): shared zod contracts, device-secret auth (scrypt), devices, subscriptions (an added address returns the already published outages and records them as `in_app`, nothing is pushed), my outages, outage detail with geometry, city browse, reports, delete-my-data, rate limit on registration. `main.ts` wires config, migrations, the API and the jobs; verified by booting it against the local database and driving it with curl.
8. **Admin** (done, `docs/api.md`): token + IP-allowlist protected endpoints and the minimal server-rendered page: unresolved queue (one-click confirm of a candidate pins a `manual` alias, re-resolves and reloads the gazetteer; "not a street"), spot check of auto-accepts (a rejected one goes back to the queue), reduced pages with "confirm as real", health, reports. `@fastify/helmet` on the admin scope only, no CORS.
9. **Monitoring** (done): the `monitor` job (every 10 minutes) evaluates the conditions and records alerts (`src/monitor/checks.ts`): zero rows on every page two fetches in a row, resolution below 95% (at least 20 segments), a new unresolved segment of a future outage (with the admin link), more than 1% of at least 20 spot-checked auto-accepts rejected, push failures above 10% (at least 20 sends in 24 h), no successful fetch for 14 hours, plus the alerts the ingest and jobs already raise (broken page, flip-flop, fetch failure). Open, unannounced alerts go out as one batch by email (SMTP) and/or push to the admin's device(s), and always to the log; a failing sink keeps them pending. `/healthz` also checks the database (503 when it is down).
10. **Deployment files** (done, `docs/ops.md`): `apps/server/Dockerfile`, `docker/compose.prod.yaml` (own network and volumes, limits, restart policies, log rotation, healthchecks; optional `caddy` and `offsite` profiles), `Makefile` (`deploy` runs the migrations in a one-off container before the server restarts), nightly dump + off-site copy + restore test, `docker/prod.env.example`. Built and exercised locally against a throwaway stack (migrate, gazetteer import, health, admin, backup, restore, off-site copy). The deploy itself waits for the server (ask before any ssh/deploy).

## Testing

Vitest + Testcontainers against `postgis/postgis:18-3.6` (same image as `docker/compose.yaml`). Replaying `fixtures/eds/**` is the main end-to-end check. Local manual testing with curl and a seeded fake subscription.

## Decisions of 22 Oct (resolved)

- **One rule for updates: what a person was last told must match what EDS shows now.** The dedupe key is `UNIQUE(subscription_id, outage_id, kind, revision)`; the outage's revision goes up only when it really changes state again (a cancellation, an undone cancellation, a reverted change), so every flip A→B→A→B is told and a repeat run with nothing new sends nothing. BRIEF §4/§5/§8 and `CLAUDE.md` were updated.
- **Undone cancellation:** new kind `reinstated` ("Isključenje ipak važi: …"), sent only to people who got "Otkazano" (a still-waiting "Otkazano" is withdrawn instead), on the "Izmena" Android channel, with the usual quiet-hours and urgent rules.
- **Flip-flop alert:** an outage that flips more than twice raises a monitoring alert (step 9).
- **A new address gets no push for outages already published:** the app shows them on screen (the `/v1` subscription response returns them) and they are recorded in `notification_log` with status `in_app` ("told in the app"), so later changes ("Izmena"/"Otkazano") and the 19:15 reminder still reach the person.
- **Broken page guard:** a page fetched with HTTP 200 that is truncated, has no outage table, or has fewer than half the rows of the previous healthy fetch for the same date does not count towards "missing"; it is treated as a failed fetch for cancellation purposes and raises an alert.

- **Mass cancellations (22 Oct, review of step 7):** the "fewer than half" rule applies only when the previous good fetch had at least 5 rows (a page going from 1 outage to none is an ordinary cancellation, as with Belgrade's Dan_2 on 22 Oct). A second fetch that is again below half is taken as real (`confirmed_reduced`), whatever its row count. The admin page has "Confirm as real", which pairs changes and runs the missing pass exactly like a normal fetch.
- **Device secret** is the only credential for v1. `POST /v1/devices` with a push token already on file takes it over (old device and addresses dropped); the app (Phase 3) keeps its own address list and re-registers and re-adds when the secret is missing.
- **Evening-before** is skipped for a person whose "new" went out less than 2 hours earlier.
- **Admin (22 Oct, close-out):** reached over an SSH tunnel only; never through a public proxy. Village segments reach the unresolved queue and confirming one pins a `settlement_alias`.
- **Off-site backups:** Backblaze B2 through an rclone crypt remote, configured but off until the server exists.

## Deviations from the plan and the brief (all approved)

| Item                       | Brief / plan                            | What was built                                                                                                                                            |
| -------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolution ladder location | `pg_trgm` and PostGIS inside SQL        | The Phase 1 TypeScript `Resolver` is loaded from Postgres into memory; Postgres stays the system of record (PostGIS geometry, `pg_trgm` for admin search) |
| Dedupe constraint          | `UNIQUE(subscription, outage, kind)`    | `UNIQUE(subscription, outage, kind, revision)` so every real flip is told; BRIEF and CLAUDE.md updated                                                    |
| Notification kinds         | new, evening_before, changed, cancelled | plus `reinstated`; notification status `in_app` for outages shown on screen when an address is added                                                      |
| Sending real push          | Phase 2 end to end with curl            | A push provider interface with a fake and a log provider; real Expo delivery is Phase 4                                                                   |
| Admin auth                 | token + IP allowlist                    | token + IP allowlist + same-site check on posts; SSH tunnel only in production; helmet on the admin scope only                                            |
| Alerts                     | email + admin push                      | email (SMTP), admin push (through the provider, arrives with Phase 4), and the log                                                                        |
| Scoring thresholds         | tuned in Phase 1                        | still provisional: the Phase 1 gate has not passed                                                                                                        |

## Known limitations of step 5

- **Settlement names in notifications** use a transliterated Latin name (OSM has no Latin name stored for them yet).
- **Cyrillic overrides** (`CYRL_OVERRIDES`) are empty: the fixed copy contains no word where lj/nj/dž are two letters.
- Quiet-hour edits by the user are stored as `{start, end}` on the device and applied at planning time; a notification already held does not move if the user edits them afterwards.
