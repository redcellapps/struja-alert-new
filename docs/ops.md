# Operations runbook

How the server runs in production, how to deploy it, and what to do when something is wrong. Nothing here has been run on the production machine yet: the deploy waits for the server (Phase 2 exit) and every `ssh`/deploy step is asked for first.

## What runs

`docker/compose.prod.yaml` is one stack with its own network, database volume, limits, restart policies and log rotation:

| Service   | What                                                                             | Limits          | Exposed                         |
| --------- | -------------------------------------------------------------------------------- | --------------- | ------------------------------- |
| `db`      | `postgis/postgis:18-3.6`, volume `dbdata`                                        | 1 CPU, 1 GB     | nothing (internal network only) |
| `server`  | Fastify API, the scheduler (pg-boss jobs) and the admin page, one process        | 1 CPU, 512 MB   | `127.0.0.1:3000` only           |
| `offsite` | optional profile: copies dumps off the machine (rclone)                          | 0.5 CPU, 256 MB | nothing                         |
| `caddy`   | optional profile: TLS reverse proxy, only if the machine has no proxy of its own | 0.5 CPU, 128 MB | 80, 443                         |

Logs are JSON files rotated at 3 × 10 MB per container. The server restarts on failure (`unless-stopped`); its healthcheck is `GET /healthz`, which also checks the database.

**Reverse proxy: not decided yet.** The brief says to use the machine's existing proxy if there is one and add Caddy only if not. That is checked on the server before the first deploy. Either way the server is published on the loopback only.

## First-time setup

1. Install Docker (Compose v2) and `make` on the machine, clone the repository.
2. `cp docker/prod.env.example docker/.env.prod` and fill it in (never commit it; `.env.*` is git-ignored):
   - `POSTGRES_PASSWORD`: a long random password.
   - `SCRAPER_CONTACT_EMAIL`: a real project mailbox, **not** a personal address. It goes into the User-Agent sent to elektrodistribucija.rs, and the server refuses to scrape without it.
   - `ADMIN_TOKEN`: 16+ characters, e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`. Without it `/admin` is not served at all.
   - `ADMIN_IP_ALLOWLIST`, `TRUST_PROXY`: see "Admin access".
   - Alerts: `SMTP_URL` + `ALERT_EMAIL_FROM` + `ALERT_EMAIL_TO` for email, `ADMIN_PUSH_TOKENS` for push to your own phone (Phase 4). With neither, alerts go to the log only.
3. `make deploy` (or the commands it runs, below). On the first start the server applies the migrations and, because the database has no streets yet, loads the Niš gazetteer from the OSM snapshot bundled in the image (`IMPORT_GAZETTEER=true`: it only imports into an empty `street` table).
4. Check: `make ps` shows `healthy`; `curl http://127.0.0.1:3000/healthz`; `make logs`.

## Deploying an update

`make deploy` on the server does:

1. `git pull --ff-only`
2. `docker compose … build server`
3. **migrations first**: `make migrate` starts the database and runs `migrate-cli.ts` in a one-off container of the _new_ image; the old server keeps serving meanwhile. (The server also runs migrations at start, which is a no-op afterwards.)
4. `up -d` restarts the server on the new image, then waits for `healthy`.

The rule that makes this safe: a migration only adds (columns, tables, indexes) while the previous version is still serving; anything that removes or renames goes in a later release, once no running version uses it.

**Rollback:** `git checkout <previous tag or commit>`, `make build up`. A migration is never rolled back by hand: if a release needs one undone, ship a new migration. If data is damaged, restore (below).

Profiles: `make up PROFILES='--profile caddy --profile offsite'`.

## Admin access

`/admin` needs the token **and** a client address on `ADMIN_IP_ALLOWLIST` (exact addresses or IPv4 CIDR). Pick one:

- **Behind a reverse proxy (recommended).** Set `TRUST_PROXY=true` and make the proxy _overwrite_ `X-Forwarded-For` with the real client address (nginx: `proxy_set_header X-Forwarded-For $remote_addr;`, not `$proxy_add_x_forwarded_for`; Caddy does this by default). `ADMIN_IP_ALLOWLIST` is then your own address. The Caddyfile also blocks `/admin` for everybody else (`ADMIN_ALLOWED_IPS`).
- **SSH tunnel, no proxy:** `ssh -L 3000:127.0.0.1:3000 server`, then open `http://127.0.0.1:3000/admin`. Docker shows the tunnel's source as the bridge gateway (172.x), so set `ADMIN_IP_ALLOWLIST=172.16.0.0/12` (only the loopback is published, so nothing else can reach it).

A browser asks for a login: any user name, the token as the password. Scripts send `Authorization: Bearer <token>`. API: `docs/api.md`.

## Alerts

The `monitor` job runs every 10 minutes. Conditions (`apps/server/src/monitor/checks.ts`), each raising one alert while it holds and closing it when it stops:

| Alert                | When                                                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| `zero_rows`          | every page of a city had zero rows in two fetches in a row                        |
| `resolution_low`     | under 95% of the upcoming outages' segments resolved (at least 20 segments)       |
| `unresolved_segment` | a new unresolved segment on a future outage (message links to `/admin`)           |
| `spot_check_rejects` | over 1% of at least 20 spot-checked auto-accepts rejected in 30 days              |
| `push_failures`      | over 10% of at least 20 sends failed in 24 hours                                  |
| `scrape_stale`       | no successful fetch for 14 hours (scheduler stopped)                              |
| `scrape_failed`      | a page could not be fetched, decoded or ingested                                  |
| `broken_page`        | truncated page, no outage table, or a drop to under half of a baseline of 5+ rows |
| `flip_flop`          | an outage switched version more than twice                                        |

New alerts are sent as one batch (email and/or admin push, and always the log). If the channel is down they stay pending and are retried on the next tick.

**A reduced page** (`broken_page` with "fewer than half"): open `/admin`, "Reduced pages". If EDS really cancelled most outages (it happens, e.g. Belgrade regenerating its pages), press "Confirm as real"; otherwise do nothing, the next healthy fetch clears it. A second fetch that is again below half is taken as real automatically.

## Backups

- **Nightly dump** at 03:30 Europe/Belgrade by the server (`pg_dump --format=custom`, the client matches PostgreSQL 18), into the `backups` volume, **14 days of retention**. `make backup-now` takes one on demand.
- Today the dump lives **on the same machine** as the database. That is acceptable for now; it does not protect against losing the machine. **Step 10 adds the off-site copy below**, which should be switched on before real users.
- **Off-site copy:** the `offsite` profile runs rclone every six hours, copies new dumps to a remote and deletes remote dumps older than `OFFSITE_KEEP_DAYS` (30). The remote is configured entirely through `docker/.env.prod`, for example SFTP to another machine or an S3/Backblaze bucket (rclone documents each backend; `RCLONE_CONFIG_OFFSITE_*`). Dumps contain device push tokens, so use an encrypted remote (an rclone `crypt` layer, or encryption at the storage side). Which destination to use is a decision for the owner; the default `OFFSITE_REMOTE=offsite:struja-backups` is only a placeholder.
- **Restore test** (do it once after the first deploy, then after changing the schema substantially): `make restore-test` restores the newest dump into a scratch database next to the real one and prints row counts of both. It was exercised locally against a throwaway stack (backup → restore → counts equal → off-site copy of the dump) while writing this.

**Restoring for real** (after data loss): stop the server (`docker compose … stop server`), then

```sh
docker compose --env-file docker/.env.prod -f docker/compose.prod.yaml exec -T db \
  psql -U struja -d postgres -c "DROP DATABASE struja" -c "CREATE DATABASE struja"
docker compose … exec -T db psql -U struja -d struja -c "CREATE EXTENSION postgis" -c "CREATE EXTENSION pg_trgm"
docker compose … exec -T server cat /backups/struja-<timestamp>.dump | docker compose … exec -T db pg_restore -U struja -d struja --no-owner --exit-on-error
docker compose … start server
```

Fetch the dump from the off-site remote into the `backups` volume first if the machine itself was lost. After a restore the app's devices still have valid secrets (they are in the dump); outages published since the dump come back at the next scrape.

## Day-to-day

- **Logs:** `make logs`. Each alert is logged as `ALERT <kind>: …`.
- **Status:** `make ps`, `GET /healthz`, `/admin` (health block).
- **A failed deploy:** `make logs`, fix, redeploy; or roll back as above.
- **Disk:** the `dbdata` volume and the dumps grow slowly (the whole Niš gazetteer is a few MB); check `docker system df` now and then.
- **Upgrading PostgreSQL major version** is a planned operation (dump, new volume, restore), not an image bump.

## Not done yet

- The real deploy, and the choice between the machine's reverse proxy and the Caddy profile.
- Off-site destination and its credentials (owner's decision), then switching the `offsite` profile on.
- Real push delivery (`LogPushProvider` only logs until Phase 4), so alerts by push to the admin phone arrive in Phase 4 too.
- The collector workflow (GitHub Actions) keeps running independently of this stack; it only saves fixtures.
