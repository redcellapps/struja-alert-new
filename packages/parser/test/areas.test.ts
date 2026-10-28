import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  areaAt,
  assembleRings,
  buildSettlementAreas,
  type OsmAreaRelation,
  type SettlementArea,
} from '../src/index.ts';

type P = [number, number];
const way = (...pts: P[]) => pts.map(([lat, lon]) => ({ lat, lon }));

describe('assembleRings', () => {
  it('joins ways that share end nodes into one closed ring, whatever their direction', () => {
    const a: P[] = [
      [0, 0],
      [0, 1],
    ];
    const b: P[] = [
      [0, 1],
      [1, 1],
    ];
    const c: P[] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ]; // runs the other way round
    const rings = assembleRings([a, b, c]);
    expect(rings).toHaveLength(1);
    expect(rings[0]?.[0]).toEqual(rings[0]?.[rings[0].length - 1]);
  });

  it('drops a ring that does not close', () => {
    expect(
      assembleRings([
        [
          [0, 0],
          [0, 1],
        ],
      ]),
    ).toEqual([]);
  });
});

describe('areaAt', () => {
  const square = (name: string, s: number, w: number, n: number, e: number, id: number) => ({
    type: 'relation',
    id,
    tags: { admin_level: '9', name },
    members: [
      {
        type: 'way',
        role: 'outer',
        geometry: way([s, w], [s, e], [n, e], [n, w], [s, w]),
      },
    ],
  });
  const areas = buildSettlementAreas([
    square('Ниш (Палилула)', 43.0, 21.0, 43.4, 21.4, 1),
    square('Трупале', 43.2, 21.2, 43.3, 21.3, 2), // a village inside the city's box
  ] as OsmAreaRelation[]);

  it('names an urban part of the city after its municipality', () => {
    expect(areas.map((a) => [a.label, a.kind, a.municipality])).toEqual([
      ['Палилула', 'urban', 'palilula'],
      ['Трупале', 'place', null],
    ]);
  });

  it('finds the settlement a point lies in, the smallest when boundaries overlap', () => {
    expect(areaAt(areas, 43.25, 21.25)?.label).toBe('Трупале');
    expect(areaAt(areas, 43.05, 21.05)?.label).toBe('Палилула');
    expect(areaAt(areas, 44, 22)).toBeNull();
  });
});

// ------------------------------------------------------------------ the real boundaries

const json = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/osm/${name}`, import.meta.url), 'utf8'));

describe('the real Niš settlement boundaries', () => {
  const areas: SettlementArea[] = buildSettlementAreas(json('nis-settlement-areas.json').elements);

  it('has the four urban parts of the city and about seventy villages, every ring closed', () => {
    expect(
      areas
        .filter((a) => a.kind === 'urban')
        .map((a) => a.label)
        .sort(),
    ).toEqual(['Медијана', 'Палилула', 'Пантелеј', 'Црвени Крст']);
    expect(areas.length).toBeGreaterThanOrEqual(70);
    for (const a of areas) {
      for (const ring of a.rings) expect(ring[0], a.label).toEqual(ring[ring.length - 1]);
    }
  });

  it('puts the centre of Niš in the city and Трупале in its own village', () => {
    expect(areaAt(areas, 43.3209, 21.8958)?.kind).toBe('urban'); // the fortress
    expect(areaAt(areas, 43.3578, 21.8172)?.label).toBe('Трупале');
  });
});
