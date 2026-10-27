// Where the map tiles come from. Everything the app needs to move to another host (a self-hosted
// OpenFreeMap, or later Protomaps) is here, or in two build-time variables:
//   EXPO_PUBLIC_MAP_TILES_URL    the TileJSON of the vector tiles (OpenMapTiles schema)
//   EXPO_PUBLIC_MAP_GLYPHS_URL   the font glyph URL, with {fontstack} and {range}
// A host with another tile schema (Protomaps) also needs the layer names in `style.ts`.
export const MAP_CONFIG = {
  tilesUrl: process.env.EXPO_PUBLIC_MAP_TILES_URL ?? 'https://tiles.openfreemap.org/planet',
  glyphsUrl:
    process.env.EXPO_PUBLIC_MAP_GLYPHS_URL ??
    'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  fontRegular: 'Noto Sans Regular',
  fontBold: 'Noto Sans Bold',
  // Shown on the map at all times (OSM licence, OpenMapTiles licence, the tile host). The first two
  // are required; the host is credited as it asks.
  attributionText: '© OpenStreetMap · © OpenMapTiles · OpenFreeMap',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  // The map must be drawn within this long, or the outage detail goes on without it.
  timeoutMs: 8000,
} as const;
