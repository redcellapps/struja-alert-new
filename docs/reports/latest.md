# Phase 3, step 10: the map on the outage detail (with the spike first)

Date: 2026-10-27. Branch `main`.

## Git

`11f0e61` (the housekeeping and the comparison) is pushed. This step is one commit after it, **not pushed**; it waits for Milan's OK. The screenshots are in `docs/screens/android/step10/` (a git-ignored working set, as for earlier steps; the final QA set is committed at step 11).

Also done first, as asked: the server test workers are capped at two (`maxWorkers: 2` in `apps/server/vitest.config.ts`; each file starts its own Postgres container). The suite passes in 53 s.

## The spike (one day's questions, answered)

| Question                                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does it render on RN 0.88 (new architecture)? | Yes. `@maplibre/maplibre-react-native` 11.5.0, debug build on the emulator (x86_64): an OpenFreeMap style loaded and drew in about 1.6 s, with a street from our data drawn natively over it (`spike-positron.png`, `spike-dark.png`, `spike-liberty.png`)                                                                                                                                                                  |
| Does it build on Windows with our setup?      | Yes: debug builds in 2 to 3 minutes, release in 6; the existing short-path workaround for CMake is enough. No Mac needed for Android                                                                                                                                                                                                                                                                                        |
| APK size                                      | Release, universal APK (four ABIs): **108.2 MB before, 153.1 MB after (+44.9 MB)**. Per ABI, which is what a Play user downloads: `libmaplibre.so` is 10.8 MB on arm64-v8a (+11.7 MB native libraries in all) and 7.9 MB on armeabi-v7a (+8.6 MB)                                                                                                                                                                           |
| Latin / Cyrillic labels                       | The tiles carry `name:sr-Latn` (proper diacritics, "Kalač brdo"), `name:sr` (Cyrillic), `name:latin` (ASCII only, "Kalac brdo": not used first), `name:nonlatin`, and `name`. So Latin reads `name:sr-Latn`, then `name:latin`, then `name`; Cyrillic reads `name:sr`, then `name:nonlatin`, then `name`. Checked on the emulator in both scripts. OpenFreeMap's own styles print both scripts on two lines; ours picks one |
| A dark style                                  | OpenFreeMap has a ready one, but I built our own light and dark styles from the app's palette (below), so both fit                                                                                                                                                                                                                                                                                                          |
| PMTiles on Android                            | Only a note for later (as asked): not tested; `docs/map.md` says what changes for Protomaps                                                                                                                                                                                                                                                                                                                                 |

## What was built

- **Library and permissions.** MapLibre's own manifest adds `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`. The existing manifest test caught it on the first build. They are now blocked in `app.json` (`android.blockedPermissions`, with background location too); the merged manifest of the last build is clean again.
- **Base map (`src/map/style.ts`).** Our own style over OpenMapTiles-schema vector tiles: land, parks, water, buildings, three road tiers with casings, rail and paths, road labels along the line, place labels, house numbers from zoom 17. Light and dark variants take their colours from the palette (`design/tokens.ts`: card and raised for land and roads in light, card and background in dark, text colours for labels).
- **The tile host is in config.** `src/map/config.ts` holds the TileJSON URL, the glyph URL, the fonts, the credit and its link, the timeout. `EXPO_PUBLIC_MAP_TILES_URL` and `EXPO_PUBLIC_MAP_GLYPHS_URL` override the two URLs at build time. Moving to a self-hosted OpenFreeMap is one change; Protomaps also needs the layer names (documented in `docs/map.md`).
- **Our geometry, drawn natively.** The GeoJSON of `GET /v1/outages/:id` goes in as a source: a casing and a line in the status colour of the outage (thin zoomed out, thick zoomed in), a circle for a settlement, a fill for an area.
- **The person's house.** New in the API: each entry of `mine` has `point` (`{ lng, lat }` or `null`). The server looks the house up in `address_point` (OSM) by street and number; no number, or no OSM point, gives `null`. Shared schema, mock, live contract test, `docs/api.md` and a server test (a point is returned once the house has one; none for an address without a number) updated. On the map: a lime dot with a dark ring and a soft halo.
- **Never blank or broken.** A placeholder of the same size shows while it loads. The map counts as drawn only when a query of the base layers finds something in view (polled every 0.6 s): a style can load while every tile fails. If the style fails to load, or nothing is in view within 8 s, the map is removed and the street list stands alone. With no network (the saved copy of the detail is shown) it is not even started. **No offline tile download.**
- **Attribution.** "© OpenStreetMap · © OpenMapTiles · OpenFreeMap" is on the map at all times, bottom right, and opens the OSM copyright page; the native logo and info button are off, so the credit is never behind a toggle. Its text grows at most 10 % with the system font (at 200 % it wrapped over part of the map before; now smaller).
- **Privacy text and credits (O aplikaciji).** Podešavanja > Privatnost now says the map comes from OpenFreeMap, which sees the phone's IP address and the area of the outage being viewed, not the saved addresses; the About text credits the map data. All three languages; the Cyrillic generator now keeps `OpenStreetMap`, `OpenMapTiles`, `OpenFreeMap`, `IP` and `©` in Latin (`cyrillic.ts`, tests).
- **Still picture.** No pan, zoom or rotate (it sits in a scrolling sheet); hidden from TalkBack; the street list is the accessible version.
- Docs: `docs/map.md` (how it works, how to change the host, the fallback rules, privacy), a rule in `CLAUDE.md`, `docs/phase3-plan.md` step 10 marked done.

## Checked on the emulator against the real local stack

| What                          | Result                                                                                 | Screenshot                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Outage detail, light, Latin   | base map, streets in red, a village as a point, credits, house marker on Trebinjska 34 | `03-detail-map-light.png`, `05-detail-map-house.png`        |
| Dark, Cyrillic                | dark style from the palette, Cyrillic labels ("Ниш", "Медошевац")                      | `06-detail-map-dark.png`, `07-detail-map-dark-cyrillic.png` |
| Privacy and About in Cyrillic | OpenFreeMap named, brand names in Latin                                                | `08-privacy-about-cyrillic.png`                             |
| Tile host down                | placeholder first, then the map is gone and the street list stands alone               | `09-fail-loading.png`, `10-fail-no-map.png`                 |
| 360 dp and 200 % font         | the map fits, the credits wrap (capped further afterwards)                             | `11-detail-360dp-200pct.png`                                |
| Release build                 | installs and starts cold, no crash (`12-release-cold-start-onboarding.png`)            |                                                             |

Problems found on the way, and fixed: the road casings were invalid (a zoom expression inside an addition), which MapLibre reported as a warning and dropped; now a test walks both styles and fails on that class of mistake. The native map reports every failed tile request as an error, which raised a red toast in development; expected network failures are filtered (`logging.ts`, tested), a broken style is still reported. The house marker only appeared after the app's 5-minute query cache expired (a persisted cache, not a map problem).

## Limits and notes

- **The release build could not be taken to the map.** A release build refuses cleartext `http://10.0.2.2:3000`, so with the local server its street list cannot load (`EXPO_PUBLIC_API_URL` needs an https address, as `runtime.ts` says). The release build starts and the same JavaScript and native library are exercised in the debug build; the release map needs the real server over https (Phase 5).
- When an outage spans a wide area (a far village in the same outage), the camera fits all of it and the streets are small; the street list and the marker still say what concerns the person. Zooming to the part nearest the house is possible if wanted.
- Play Data safety: the library documents no telemetry; the tile host's view of the IP address and the requested tiles is what the privacy text declares. OpenFreeMap's privacy policy still has to be read for the form (Phase 6). OpenFreeMap has no SLA; the fallback above is why that is acceptable, and `docs/map.md` says how to move to Protomaps on R2.

## Gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · `pnpm test` green. Tests: mobile **320** jest (+23: map style, geometry, component states, logging, privacy text, Cyrillic brands, outage detail) + 29 contract (6 live ones skip without `LIVE_API_URL`) · server **241** · parser 147 (144 + 3 todo) · shared 22 · scripts 62. The live contract (6 tests) also passes against the running local server, including the house point.

## Decisions needed

1. OK to push this step's commit?
2. Zoom to the part of the outage nearest the person's house, instead of fitting the whole outage?
3. Step 11 (Maestro, which needs your approval to install) next?
