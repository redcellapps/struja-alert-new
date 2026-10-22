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
8. **Admin:** token-protected endpoints plus the minimal server-rendered page (unresolved queue with one-click confirm/reject, spot-check list of auto-accepts); IP allowlist.
9. **Monitoring** alerts (email + admin push) and `/healthz`.
10. **Deployment files:** `docker/compose.prod.yaml`, `docs/ops.md`. The deploy itself waits for the server (ask before any ssh/deploy).

## Testing

Vitest + Testcontainers against `postgis/postgis:18-3.6` (same image as `docker/compose.yaml`). Replaying `fixtures/eds/**` is the main end-to-end check. Local manual testing with curl and a seeded fake subscription.

## Decisions of 22 Oct (resolved)

- **One rule for updates: what a person was last told must match what EDS shows now.** The dedupe key is `UNIQUE(subscription_id, outage_id, kind, revision)`; the outage's revision goes up only when it really changes state again (a cancellation, an undone cancellation, a reverted change), so every flip A→B→A→B is told and a repeat run with nothing new sends nothing. BRIEF §4/§5/§8 and `CLAUDE.md` were updated.
- **Undone cancellation:** new kind `reinstated` ("Isključenje ipak važi: …"), sent only to people who got "Otkazano" (a still-waiting "Otkazano" is withdrawn instead), on the "Izmena" Android channel, with the usual quiet-hours and urgent rules.
- **Flip-flop alert:** an outage that flips more than twice raises a monitoring alert (step 9).
- **A new address gets no push for outages already published:** the app shows them on screen (the `/v1` subscription response returns them) and they are recorded in `notification_log` with status `in_app` ("told in the app"), so later changes ("Izmena"/"Otkazano") and the 19:15 reminder still reach the person.
- **Broken page guard:** a page fetched with HTTP 200 that is truncated, has no outage table, or has fewer than half the rows of the previous healthy fetch for the same date does not count towards "missing"; it is treated as a failed fetch for cancellation purposes and raises an alert.

## Known limitations of step 5

- **Settlement names in notifications** use a transliterated Latin name (OSM has no Latin name stored for them yet).
- **Cyrillic overrides** (`CYRL_OVERRIDES`) are empty: the fixed copy contains no word where lj/nj/dž are two letters.
- Quiet-hour edits by the user are stored as `{start, end}` on the device and applied at planning time; a notification already held does not move if the user edits them afterwards.
