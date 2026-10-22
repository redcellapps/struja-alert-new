# API `/v1`

The contracts are zod schemas in `packages/shared/src/schemas/` (`api.ts`, `gazetteer.ts`); the app and the server use the same ones. Every error is `{ "error": { "code", "message" } }`. Times are ISO-8601 UTC strings; the app converts to Europe/Belgrade.

## Authentication

There are no accounts. `POST /v1/devices` returns a random `deviceSecret` **once**; the app keeps it in secure storage (Keystore / Keychain) and sends

```
Authorization: Bearer <deviceId>.<deviceSecret>
```

on every other request. The server stores only a scrypt hash. Missing, malformed and wrong credentials all answer `401 unauthorized` the same way.

## Endpoints

| Method and path                                | Auth                    | What it does                                                                                                                   |
| ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /healthz`                                 | –                       | Liveness.                                                                                                                      |
| `GET /v1/cities`                               | –                       | Cities and the gazetteer version of active ones; the rest are "soon".                                                          |
| `GET /v1/cities/:city/gazetteer`               | –                       | Streets and settlements for offline search. ETag / `If-None-Match` → 304.                                                      |
| `GET /v1/cities/:city/outages?date=YYYY-MM-DD` | –                       | City-wide browse (Najave); without `date`, everything not yet over.                                                            |
| `POST /v1/devices`                             | – (rate limited per IP) | Register. `201 { deviceId, deviceSecret }`. A push token already on file is **taken over** (old device and addresses dropped). |
| `GET /v1/devices/me`                           | device                  | The device's settings.                                                                                                         |
| `PATCH /v1/devices/me`                         | device                  | `pushToken`, `locale`, `script`, `quietHours` (or `null`), `enabledKinds`.                                                     |
| `DELETE /v1/devices/me`                        | device                  | "Obriši sve moje podatke": the device, its addresses, its notification log and its reports. `204`.                             |
| `GET /v1/subscriptions`                        | device                  | Saved addresses (`max` = 3).                                                                                                   |
| `POST /v1/subscriptions`                       | device                  | Add an address (a street or a settlement, optional house number). `201 { subscription, outages }`.                             |
| `PATCH /v1/subscriptions/:id`                  | device                  | `label`, `isPrimary`, `houseNumber`, `houseSuffix`. Returns `{ subscription, outages }`.                                       |
| `DELETE /v1/subscriptions/:id`                 | device                  | Remove; another address becomes primary if this was.                                                                           |
| `GET /v1/me/outages?range=upcoming\|history`   | device                  | Outages that concern my addresses.                                                                                             |
| `GET /v1/outages/:id`                          | optional                | Window, parsed streets and ranges, the raw EDS text, GeoJSON for the map, the source; `mine` when signed in.                   |
| `POST /v1/reports`                             | device                  | "Prijavi grešku" about an outage.                                                                                              |

## Lost secret

The device secret is acceptable as the only credential for v1. If the app loses it (reinstall, cleared storage), it calls `POST /v1/devices` again with the same push token: the server drops the old device and its addresses and issues a new secret. The app keeps its own list of addresses and re-adds them; because an added address records the already published outages as told in the app (below), nothing is pushed twice.

## Adding an address does not push

`POST /v1/subscriptions` (and a house-number change) returns the outages **already published** for that address in `outages`, with `match` = `affected` or `possible` (+ `reason` = `no_number` / `partial` / `unresolved` for "Moguće pogođeno"). **Nothing is pushed for them**: the app shows them on screen right away. They are recorded server-side as told in the app (`notification_log.status = 'in_app'`), so later "Izmena" / "Otkazano" notices and the 19:15 reminder still reach the person.

## Limits and errors

`400 invalid_request` (names the field) · `401 unauthorized` · `404 not_found` / `city_not_found` / `street_not_found` · `409 limit_reached` (4th address), `primary_required` · `429 rate_limited`.

## Not in `/v1` yet

Admin endpoints and page (step 8), live-activity tokens (iOS, Phase 6), real push delivery (Phase 4).
