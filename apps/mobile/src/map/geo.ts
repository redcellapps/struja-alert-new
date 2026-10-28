import type { OutageDetailDto } from '@struja/shared';

export type Bounds = [west: number, south: number, east: number, north: number];
export type LngLatPoint = { lng: number; lat: number };

type Coords = number | Coords[];

function visit(c: Coords, f: (lng: number, lat: number) => void): void {
  if (typeof c === 'number') return;
  if (c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') f(c[0], c[1]);
  else for (const x of c) visit(x, f);
}

/** The shapes of the outage that can be drawn: features with a geometry that has coordinates. */
export function drawable(geometry: OutageDetailDto['geometry']): GeoJSON.Feature[] {
  return (geometry.features as GeoJSON.Feature[]).filter(
    (f) =>
      f?.geometry &&
      'coordinates' in f.geometry &&
      Array.isArray(f.geometry.coordinates) &&
      f.geometry.coordinates.length > 0,
  );
}

/** The features of the given streets (by street id), not the candidates of an ambiguous name. */
export function featuresOfStreets(
  features: readonly GeoJSON.Feature[],
  streetIds: readonly number[],
): GeoJSON.Feature[] {
  return features.filter((f) => {
    const p = (f.properties ?? {}) as { streetId?: number; candidate?: boolean };
    return p.candidate !== true && typeof p.streetId === 'number' && streetIds.includes(p.streetId);
  });
}

/** The area of a box in square degrees, to compare how much of the outage a view shows. */
export const boxArea = (b: Bounds): number => (b[2] - b[0]) * (b[3] - b[1]);

/**
 * The box around the shapes and the person's house, never smaller than about 400 m so a single point
 * (a village) is not zoomed to a rooftop.
 */
export function boundsOf(features: GeoJSON.Feature[], house: LngLatPoint | null): Bounds | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const add = (lng: number, lat: number) => {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  };
  for (const f of features) {
    if (f.geometry && 'coordinates' in f.geometry) visit(f.geometry.coordinates as Coords, add);
  }
  if (house) add(house.lng, house.lat);
  if (!Number.isFinite(w)) return null;
  const MIN = 0.004;
  if (e - w < MIN) [w, e] = [(w + e) / 2 - MIN / 2, (w + e) / 2 + MIN / 2];
  if (n - s < MIN) [s, n] = [(s + n) / 2 - MIN / 2, (s + n) / 2 + MIN / 2];
  return [w, s, e, n];
}
