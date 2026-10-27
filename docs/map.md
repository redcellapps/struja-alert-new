# Map on the outage detail

A small, still map on the outage detail sheet (under "Pogođene ulice"): the base map from vector tiles, the affected streets drawn over it, the person's house marked. Code: `apps/mobile/src/map/`.

## How it is built

- **Library:** `@maplibre/maplibre-react-native` (MapLibre Native). No webview, no location permission: the library's own manifest asks for `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION`, so `app.json` blocks them (`android.blockedPermissions`); `__tests__/manifest.test.ts` checks the merged manifest of the last build.
- **Base map:** our own style (`style.ts`) over OpenMapTiles-schema vector tiles from OpenFreeMap, drawn in the app's palette: a light and a dark variant, taken from `design/tokens.ts`. The labels follow the chosen script: Latin reads `name:sr-Latn` (with diacritics), then `name:latin`, then `name`; Cyrillic reads `name:sr`, then `name:nonlatin`, then `name`.
- **Our data:** the street geometry is the GeoJSON of `GET /v1/outages/:id`, drawn natively (line, a wider casing under it, a circle for a settlement, a fill for an area) in the status colour of the outage. The person's house is a lime dot with a dark ring, from `mine[].point` of the same answer: the server looks the house up in `address_point` (OSM) for an address with a number; no number, or no point in OSM, no marker.
- **Camera:** fits the shapes and the house, never closer than about 400 m across, never beyond zoom 17. The map is a still picture: no pan, zoom or rotate (it sits inside a scrolling sheet), and hidden from the screen reader; the street list under it is the accessible version.

## Where the tiles come from, and changing it

`src/map/config.ts` is the one place: `tilesUrl` (the TileJSON), `glyphsUrl`, the fonts, the credit text and its link, the timeout. Two build-time variables override the URLs without a code change: `EXPO_PUBLIC_MAP_TILES_URL`, `EXPO_PUBLIC_MAP_GLYPHS_URL`.

- **Self-hosted OpenFreeMap** (same schema): change the two URLs.
- **Protomaps** (a `pmtiles://` source and a different schema): also change the `source-layer` names and the label fields in `style.ts`; and check that MapLibre Native in this library reads PMTiles on Android (not tested yet).

Never use `tile.openstreetmap.org` for the app: best effort, no SLA, may be blocked, forbids prefetching and offline use.

## It never shows a blank or broken map

- While it loads, a placeholder of the same size is shown.
- The map counts as drawn when the base map has something in view (a query of the base layers), checked every 0.6 s; the style loading is not enough, because a style can load while every tile fails.
- If the style fails to load, or no tile is in view within 8 s, the map is removed and the street list stands alone. No network (the saved copy of the detail is shown): the map is not even started.
- The native map's errors for a failed tile request are expected and are not raised as errors (`logging.ts`); a broken style still is.
- **No offline tile download**, no cache of our own.

## Attribution and privacy

- The credits "© OpenStreetMap · © OpenMapTiles · OpenFreeMap" are on the map at all times, bottom right, and open the OSM copyright page. The native logo and the info button are off, so the credit is not behind a toggle.
- "O aplikaciji" lists the map data credits; the privacy text in Podešavanja says that the map comes from OpenFreeMap, which sees the phone's IP address and the area of the outage being viewed, but not the saved addresses (in all three languages; the Cyrillic text keeps the brand names in Latin).
- Play Data safety: the library collects nothing itself (none documented); the tile host's view of the IP address and the requested tiles is declared as the privacy text says. Re-read OpenFreeMap's privacy policy when the form is filled in (Phase 6).

## Checking it

`pnpm --filter @struja/mobile live-contract` includes the geometry and the house point against the real server. For a look on the emulator: the real server with `dev:fixtures --shift=<minutes> --repeat-today` and `dev:scrape` (see `CLAUDE.md`); to see the failure path, start Metro with `EXPO_PUBLIC_MAP_TILES_URL=http://10.0.2.2:9/planet`.
