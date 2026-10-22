# Phase 2 plan: backend

Builds on `docs/PLAN.md` §6 and the approved additions. Each step ends with tests green and a commit; the phase ends with a summary and a stop for review.

## Architecture decision (deviation from BRIEF §3, flagged)

The brief resolves street names with `pg_trgm` (step 3) and PostGIS (step 5) inside Postgres. Phase 1 already built and measured the whole ladder as pure TypeScript in `packages/parser` (`Resolver`): it runs over the ~2,250 Niš streets in milliseconds and is the same code the app can share. So the server **loads the gazetteer from Postgres into that in-memory `Resolver`** (at startup and after alias changes) instead of re-implementing the ladder in SQL. Postgres remains the system of record (PostGIS geometry, `pg_trgm` index for admin search). Reversible: the resolver has a small interface.

The scoring weights and thresholds are **provisional** until the Phase 1 gate passes (user decision); Phase 2 uses them as they are.

## Steps

1. **Schema + migrations** (done): Drizzle schema for every table of BRIEF §4 plus `settlement`, `gazetteer_version`; migration 0000 creates `postgis`/`pg_trgm`; integration tests on a real PostGIS container (Testcontainers). The `notification_log` dedupe constraint is tested.
2. **Gazetteer in the database:** import the OSM snapshots (streets, settlements, address points, aliases); load them back into a `Resolver`; `GET /cities`, `GET /cities/:city/gazetteer` with an ETag.
3. **Ingestion:** fetch → hash → parse → split → resolve → persist (`outage`, `outage_street`, identity key, in-scope flag, `scrape_run`); replaying the saved fixtures produces the expected rows; unresolved segments keep their top-5 candidates.
4. **Change and cancellation detection** by identity key (changed time; "missing for two consecutive runs" for future dates).
5. **Matcher and notifications:** match subscriptions (house ranges, parity, "Moguće pogođeno"), notification kinds and copy in sr-Latn / sr-Cyrl / en, quiet hours, urgent rule, Expo push with receipts, dedupe through `notification_log`. Fixture replay yields exactly one notification per (subscription, outage, kind).
6. **Jobs** with pg-boss in Europe/Belgrade: scrape 07/13/19, evening reminder 19:15, outage start/end triggers, receipts, nightly backup. No live scraping during development: jobs read fixtures.
7. **API `/v1`** with the shared zod schemas and device-secret auth: devices, subscriptions, outages, reports, delete-my-data.
8. **Admin:** token-protected endpoints plus the minimal server-rendered page (unresolved queue with one-click confirm/reject, spot-check list of auto-accepts); IP allowlist.
9. **Monitoring** alerts (email + admin push) and `/healthz`.
10. **Deployment files:** `docker/compose.prod.yaml`, `docs/ops.md`. The deploy itself waits for the server (ask before any ssh/deploy).

## Testing

Vitest + Testcontainers against `postgis/postgis:18-3.6` (same image as `docker/compose.yaml`). Replaying `fixtures/eds/**` is the main end-to-end check. Local manual testing with curl and a seeded fake subscription.
