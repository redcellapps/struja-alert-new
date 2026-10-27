# API `/v1`

The contracts are zod schemas in `packages/shared/src/schemas/` (`api.ts`, `gazetteer.ts`); the app and the server use the same ones. Every error is `{ "error": { "code", "message" } }`. Times are ISO-8601 UTC strings; the app converts to Europe/Belgrade.

## Authentication

There are no accounts. `POST /v1/devices` returns a random `deviceSecret` **once**; the app keeps it in secure storage (Keystore / Keychain) and sends

```
Authorization: Bearer <deviceId>.<deviceSecret>
```

on every other request. The server stores only a scrypt hash. Missing, malformed and wrong credentials all answer `401 unauthorized` the same way.

## Endpoints

| Method and path                                | Auth                    | What it does                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                                 | –                       | Liveness.                                                                                                                                                                                                                                       |
| `GET /v1/cities`                               | –                       | Cities and the gazetteer version of active ones; the rest are "soon".                                                                                                                                                                           |
| `GET /v1/cities/:city/gazetteer`               | –                       | Streets and settlements for offline search. ETag / `If-None-Match` → 304 (the header carries the body's `etag` in quotes).                                                                                                                      |
| `GET /v1/cities/:city/outages?date=YYYY-MM-DD` | –                       | City-wide browse (Najave); without `date`, everything not yet over.                                                                                                                                                                             |
| `POST /v1/devices`                             | – (rate limited per IP) | Register. `201 { deviceId, deviceSecret }`. A push token already on file is **taken over** (old device and addresses dropped).                                                                                                                  |
| `GET /v1/devices/me`                           | device                  | The device's settings.                                                                                                                                                                                                                          |
| `PATCH /v1/devices/me`                         | device                  | `pushToken`, `locale`, `script`, `quietHours` (or `null`), `enabledKinds`.                                                                                                                                                                      |
| `DELETE /v1/devices/me`                        | device                  | "Obriši sve moje podatke": the device, its addresses, its notification log and its reports. `204`.                                                                                                                                              |
| `GET /v1/subscriptions`                        | device                  | Saved addresses (`max` = 3).                                                                                                                                                                                                                    |
| `POST /v1/subscriptions`                       | device                  | Add an address (a street or a settlement, optional house number). `201 { subscription, outages }`.                                                                                                                                              |
| `PATCH /v1/subscriptions/:id`                  | device                  | `label`, `isPrimary`, `houseNumber`, `houseSuffix`. Returns `{ subscription, outages }`.                                                                                                                                                        |
| `DELETE /v1/subscriptions/:id`                 | device                  | Remove; another address becomes primary if this was.                                                                                                                                                                                            |
| `GET /v1/me/outages?range=upcoming\|history`   | device                  | Outages that concern my addresses.                                                                                                                                                                                                              |
| `GET /v1/outages/:id`                          | optional                | Window, parsed streets and ranges, the raw EDS text, GeoJSON for the map, the source; `mine` when signed in (each entry has `point`, the person's house as `{ lng, lat }` when the address has a number that OSM has a point for, else `null`). |
| `POST /v1/reports`                             | device                  | "Prijavi grešku" about an outage.                                                                                                                                                                                                               |

## Development push tokens

Dev builds of the app (no FCM credentials yet) register with `dev-token:<uuid>` instead of an Expo token. Only a server running with `NODE_ENV=development` accepts it; any other server answers `400 dev_token_not_allowed` on `POST /v1/devices` and `PATCH /v1/devices/me`.

## Lost secret

The device secret is acceptable as the only credential for v1. If the app loses it (reinstall, cleared storage), it calls `POST /v1/devices` again with the same push token: the server drops the old device and its addresses and issues a new secret. The app keeps its own list of addresses and re-adds them; because an added address records the already published outages as told in the app (below), nothing is pushed twice.

## Adding an address does not push

`POST /v1/subscriptions` (and a house-number change) returns the outages **already published** for that address in `outages`, with `match` = `affected` or `possible` (+ `reason` = `no_number` / `partial` / `unresolved` for "Moguće pogođeno"). **Nothing is pushed for them**: the app shows them on screen right away. They are recorded server-side as told in the app (`notification_log.status = 'in_app'`), so later "Izmena" / "Otkazano" notices and the 19:15 reminder still reach the person.

## Limits and errors

`400 invalid_request` (names the field) · `401 unauthorized` · `404 not_found` / `city_not_found` / `street_not_found` · `409 limit_reached` (4th address), `primary_required` · `429 rate_limited`.

## Not in `/v1` yet

Live-activity tokens (iOS, Phase 6), real push delivery (Phase 4).

## Admin (`/admin`, not part of `/v1`)

Served only when `ADMIN_TOKEN` (16+ characters) is set. Every request needs the token (`Authorization: Bearer <token>`, or HTTP Basic with the token as password so a browser can open the page) **and** a client address on `ADMIN_IP_ALLOWLIST` (exact addresses or IPv4 CIDR; behind a proxy set `TRUST_PROXY=true`). State-changing requests from another site are refused. `@fastify/helmet` headers (CSP and others) apply to the admin scope only; there is no CORS.

| Method and path                        | What it does                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin`                           | The page: health, alerts, reduced pages, unresolved queue, spot check, latest fetches, reports.                                                                                                                                 |
| `GET /admin/health`                    | Latest fetch per page, open alerts, resolution rate, spot-check rejects (30 d), delivery counts (24 h).                                                                                                                         |
| `GET /admin/reports`                   | Reports from the app ("Prijavi grešku").                                                                                                                                                                                        |
| `GET /admin/reduced`                   | Reduced pages waiting for a decision.                                                                                                                                                                                           |
| `POST /admin/runs/:id/confirm-reduced` | "Confirm as real": the drop happened; pairs the rows the page added with the rows it dropped (a changed time is an "Izmena") and runs the missing/cancel pass, exactly like a normal fetch. `409` if not reduced or superseded. |
| `GET /admin/unresolved`                | Segments no step could place (upcoming outages, streets **and villages**), grouped by name (`kind`: `street` or `village`), with up to 5 candidates.                                                                            |
| `POST /admin/unresolved/confirm`       | `{ segNorm, streetId                                                                                                                                                                                                            | settlementId, raw? }` (`settlementId`for villages,`segNorm`starts with`village:`): pins a `manual` street or settlement alias, re-resolves the open segments, reloads the gazetteer. |
| `GET /admin/search?segNorm=&q=`        | Streets (or settlements for villages) by name, for items with no right candidate.                                                                                                                                               |
| `POST /admin/unresolved/dismiss`       | `{ segNorm }`: "not a street", hidden from the queue.                                                                                                                                                                           |
| `GET /admin/spot-checks`               | Auto-accepted (`scored`) matches not reviewed yet.                                                                                                                                                                              |
| `POST /admin/spot-checks/review`       | `{ rowIds, decision: confirmed                                                                                                                                                                                                  | rejected }`: a rejected match goes back to unresolved.                                                                                                                               |

The page's forms post to the same endpoints; a form post (`Accept: text/html`) is answered with a redirect back to `/admin`.
