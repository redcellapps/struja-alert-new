# Phase 2 report: backend

Status: **built, tested, not deployed.** The deploy waits for the production server (about 30 days out). The Phase 1 gate (resolution quality) is **still collecting data**, so the scoring thresholds the backend uses remain provisional.

## What is done

| Step | Delivered                                                                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Drizzle schema and migrations `0000`–`0009` on `postgis/postgis:18-3.6`; Testcontainers integration tests                                                                                                                                                  |
| 2    | The Niš gazetteer in Postgres (2,250 streets, 86 settlements), loaded into the in-memory `Resolver`; `GET /v1/cities`, gazetteer endpoint with ETag                                                                                                        |
| 3    | Ingestion: fetch, hash, parse, split, resolve, persist; raw `Ulice` always kept; unresolved segments keep their top-5 candidates                                                                                                                           |
| 4    | Change and cancellation detection: pairing, change groups, reverts, `reinstated`, revisions, cancellation after two missed fetches, broken-page guard with the 5-row baseline                                                                              |
| 5    | Matcher and notifications: new, changed, cancelled, reinstated, evening-before (with the 2-hour skip), 12-hour safety net, quiet hours with the 2-hour urgent rule, outbox with retries, receipts and dead-token dropping; copy in sr-Latn, sr-Cyrl and en |
| 6    | Jobs on Europe/Belgrade (pg-boss): scrape 07/13/19, plan, evening, deliver, receipts, start/end signals, safety net, nightly `pg_dump`, monitor                                                                                                            |
| 7    | `/v1` API (docs/api.md): device-secret auth, devices (push-token takeover), subscriptions (in-app recording), my outages, outage detail with GeoJSON, city browse, reports, delete-my-data, rate limiting                                                  |
| 8    | Admin API and page: unresolved queue (streets and villages, name search, one-click confirm pins an alias), spot check of auto-accepts, reduced pages with "Confirm as real", health, reports; helmet on the admin scope only                               |
| 9    | Monitoring: nine alert kinds, delivery by email, admin push and the log, `/healthz` that checks the database                                                                                                                                               |
| 10   | Dockerfile, `docker/compose.prod.yaml`, Caddyfile (profile), Makefile, restore test, B2 crypt off-site job (off), `docs/ops.md`, CI image build                                                                                                            |

Verified beyond the unit and integration tests: the server booted against a local database and was driven with curl (step 7); the production stack was built and run locally on a throwaway project: migrations, gazetteer import, health, admin behind its token, a backup, a restore with equal row counts, and an off-site copy through an rclone crypt remote (encrypted names, content read back). CI is green on `main`, including the image build.

## Tests and coverage

All green: `pnpm lint` (zero warnings), `pnpm typecheck`, `pnpm test`. Coverage is written to `test-results/` on every run.

| Area                              | Test files | Tests         | Statements | Branches | Lines  |
| --------------------------------- | ---------- | ------------- | ---------- | -------- | ------ |
| `apps/server`                     | 17         | 224           | 91.8 %     | 82.7 %   | 93.6 % |
| `packages/parser`                 | 13         | 144 (+3 todo) | 96.3 %     | 83.6 %   | 98.6 % |
| `packages/shared`                 | 2          | 22            | 96.5 %     | 90.7 %   | 96.3 % |
| `scripts` (collector, gate tools) | 7          | 62            | 95.6 %     | 79.9 %   | 96.7 % |

Server tests by subject: schema and the dedupe constraint, gazetteer import and load, cities, ingestion and fixture replay, changes and pairing, revisions and `reinstated`, matcher, quiet hours, notifications (planner, outbox, evening skip, safety net), page health (truncated, no table, reduced, confirmed, small pages, admin confirm), jobs (handlers, schedules registered with pg-boss, backup pruning, boundary signals), API (auth, takeover, subscriptions, outages, reports, delete-my-data, rate limit), admin (access, helmet scope, queue, villages, spot check, reduced and pairing), monitoring (every alert, every sink), config.

Not covered by automated tests: the Dockerfile and compose files beyond the CI image build (exercised by hand, see above), the real SMTP transport (the sink is tested against a fake transport), the real Expo push provider (Phase 4), the real HTTP page source against elektrodistribucija.rs (by design: only the production scheduler and the collector may request it).

## Known limits

- **Resolution quality is not proven.** The Phase 1 gate (at least 95 % automatic resolution and at least 99 % auto-accept precision on in-scope rows) has 10 confirmed in-scope segments of the roughly 200 needed, so the verdict is "insufficient sample". The collector keeps gathering pages and the weekly gate report re-runs. Weights and thresholds stay provisional and are frozen only after the gate passes, before the Phase 5 live run. Until then the admin spot check and the "unresolved segment" alerts are the safety net.
- **Confirming a reduced page** pairs changes, but a reduced page that also lost rows can only be judged by a human; that is why it is a button.
- **Notifications to a wrongly auto-accepted street** that were already sent are not recalled when the admin rejects the match.
- **Settlement names in notifications** use a transliterated Latin name (OSM has none stored). Cyrillic overrides are empty.
- **Quiet hours** edited after a notification was held do not move that notification.
- **Other cities** (Belgrade, Novi Sad, Kragujevac, Kraljevo) are collected but not served; the gazetteer and the municipality scope are Niš only.
- **Push is not real yet:** `LogPushProvider` only logs, so the 19:15 reminder, change notices and admin push alerts are produced and recorded but not delivered until Phase 4.
- **Single machine:** database, server and dumps share one host until the off-site copy is switched on.

## Open decisions

1. **Reverse proxy** (the machine's existing one, or the Caddy profile): decided with the server, about 30 days out. Both are documented in `docs/ops.md`. `/admin` is never public in either case.
2. **Off-site backups:** the B2 bucket, the bucket-restricted application key and the crypt password and salt are created when the server is set up. The password and salt must go into the password manager; without them the backups cannot be read.
3. **Alert channels:** an SMTP account for alert email, and an admin device token for push alerts (after Phase 4).
4. **Scraper contact mailbox** (`SCRAPER_CONTACT_EMAIL`, a project address, not a personal one) for the production environment file.
5. **Gate:** continue collecting and labelling until the sample is large enough, then freeze the scoring.

## Next

`docs/phase3-plan.md` describes the Android app. Nothing in Phase 3 has been built.
