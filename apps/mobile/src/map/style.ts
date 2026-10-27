import type { MapProps } from '@maplibre/maplibre-react-native';
import type { Palette, ThemeName } from '../design/tokens';
import { MAP_CONFIG } from './config';

type StyleSpecification = Exclude<MapProps['mapStyle'], string>;

// The base map: our own style over OpenMapTiles-schema vector tiles, drawn in the app's palette (flat
// fills, one lime accent, no gradients) in a light and a dark variant. Names follow the chosen script:
// the tiles carry `name:sr-Latn` (with diacritics), `name:sr` (Cyrillic) and the local `name`.

export type Script = 'latn' | 'cyrl';

/** The label expression for a script. Latin: `name:sr-Latn`, then the plain-ASCII `name:latin`, then `name`. */
export function labelField(script: Script): unknown[] {
  return script === 'latn'
    ? ['coalesce', ['get', 'name:sr-Latn'], ['get', 'name:latin'], ['get', 'name']]
    : ['coalesce', ['get', 'name:sr'], ['get', 'name:nonlatin'], ['get', 'name']];
}

export interface MapColors {
  land: string;
  park: string;
  water: string;
  building: string;
  road: string;
  roadCasing: string;
  roadMinor: string;
  rail: string;
  text: string;
  textMuted: string;
}

/** Map colours from the palette: its page and card colours for land and roads, its text colours for labels. */
export function mapColors(palette: Palette, theme: ThemeName): MapColors {
  const c = palette.chrome;
  return theme === 'dark'
    ? {
        land: c.card,
        park: '#1D2616',
        water: '#0E1822',
        building: c.raised,
        road: '#33333A',
        roadCasing: c.background,
        roadMinor: '#2A2A30',
        rail: '#4A4A52',
        text: c.text,
        textMuted: c.textSecondary,
      }
    : {
        land: c.raised,
        park: '#E0EBC1',
        water: '#C6D4E1',
        building: '#DADAE1',
        road: c.card,
        roadCasing: '#CFCFD7',
        roadMinor: '#F7F7FA',
        rail: '#B4B4BE',
        text: c.text,
        textMuted: c.textSecondary,
      };
}

// A width that grows with the zoom. `extra` is added to every stop (the casing is a little wider): a zoom
// expression must be the input of a top-level interpolate, so it cannot be wrapped in an addition.
const roadWidth = (a: number, b: number, c: number, extra = 0) => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  12,
  a + extra,
  16,
  b + extra,
  19,
  c + extra,
];

const TIERS = [
  ['minor', ['minor', 'service', 'track'], [0.5, 3, 10]],
  ['mid', ['secondary', 'tertiary'], [1, 6, 18]],
  ['major', ['motorway', 'trunk', 'primary'], [1.5, 8, 24]],
] as const;

/** The layers that draw the base map from tiles: if none of them has a feature in view, no tile arrived. */
export const BASE_LAYER_IDS = [
  'water',
  'park',
  'landcover',
  'building',
  'road-minor',
  'road-mid',
  'road-major',
];

const SRC = 'openmaptiles';
const inClass = (classes: readonly string[]) => ['in', ['get', 'class'], ['literal', [...classes]]];

export function buildMapStyle(colors: MapColors, script: Script): StyleSpecification {
  const label = labelField(script);
  const style = {
    version: 8,
    sources: { [SRC]: { type: 'vector', url: MAP_CONFIG.tilesUrl } },
    glyphs: MAP_CONFIG.glyphsUrl,
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': colors.land } },
      {
        id: 'park',
        type: 'fill',
        source: SRC,
        'source-layer': 'park',
        paint: { 'fill-color': colors.park },
      },
      {
        id: 'landcover',
        type: 'fill',
        source: SRC,
        'source-layer': 'landcover',
        filter: inClass(['grass', 'wood', 'farmland']),
        paint: { 'fill-color': colors.park, 'fill-opacity': 0.6 },
      },
      {
        id: 'water',
        type: 'fill',
        source: SRC,
        'source-layer': 'water',
        paint: { 'fill-color': colors.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: SRC,
        'source-layer': 'waterway',
        minzoom: 12,
        paint: { 'line-color': colors.water, 'line-width': 1.5 },
      },
      {
        id: 'building',
        type: 'fill',
        source: SRC,
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': colors.building },
      },
      {
        id: 'rail',
        type: 'line',
        source: SRC,
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        paint: { 'line-color': colors.rail, 'line-width': 1.2, 'line-dasharray': [3, 3] },
      },
      ...TIERS.flatMap(([name, classes, [a, b, c]]) => [
        {
          id: `road-${name}-casing`,
          type: 'line',
          source: SRC,
          'source-layer': 'transportation',
          filter: inClass(classes),
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': colors.roadCasing, 'line-width': roadWidth(a, b, c, 1.6) },
        },
        {
          id: `road-${name}`,
          type: 'line',
          source: SRC,
          'source-layer': 'transportation',
          filter: inClass(classes),
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': name === 'minor' ? colors.roadMinor : colors.road,
            'line-width': roadWidth(a, b, c),
          },
        },
      ]),
      {
        id: 'path',
        type: 'line',
        source: SRC,
        'source-layer': 'transportation',
        minzoom: 14,
        filter: ['==', ['get', 'class'], 'path'],
        paint: { 'line-color': colors.rail, 'line-width': 1, 'line-dasharray': [2, 2] },
      },
      {
        id: 'road-label',
        type: 'symbol',
        source: SRC,
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': label,
          'text-font': [MAP_CONFIG.fontRegular],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13],
        },
        paint: {
          'text-color': colors.textMuted,
          'text-halo-color': colors.land,
          'text-halo-width': 1.6,
        },
      },
      {
        id: 'housenumber',
        type: 'symbol',
        source: SRC,
        'source-layer': 'housenumber',
        minzoom: 17,
        layout: {
          'text-field': ['get', 'housenumber'],
          'text-font': [MAP_CONFIG.fontRegular],
          'text-size': 10,
        },
        paint: {
          'text-color': colors.textMuted,
          'text-halo-color': colors.land,
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'place-label',
        type: 'symbol',
        source: SRC,
        'source-layer': 'place',
        filter: inClass([
          'city',
          'town',
          'village',
          'suburb',
          'neighbourhood',
          'quarter',
          'hamlet',
        ]),
        layout: {
          'text-field': label,
          'text-font': [MAP_CONFIG.fontRegular],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 13],
          'text-max-width': 8,
        },
        paint: {
          'text-color': colors.text,
          'text-halo-color': colors.land,
          'text-halo-width': 1.6,
        },
      },
    ],
  };
  return style as unknown as StyleSpecification;
}
