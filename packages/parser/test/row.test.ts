import { describe, expect, it } from 'vitest';
import {
  normalizeName,
  resolveRow,
  Resolver,
  splitUlice,
  StreetIndex,
  type NisSettlement,
  type NisStreet,
} from '../src/index.ts';

let nextId = 1;
const street = (name: string, at?: [number, number]): NisStreet => ({
  id: nextId++,
  clusterKey: String(nextId),
  settlement: null,
  name,
  nameNorm: normalizeName(name),
  altNorms: [],
  municipality: 'medijana',
  municipalities: ['medijana'],
  nameLatin: null,
  wayIds: [],
  lines: at ? [[at, [at[0] + 0.0004, at[1] + 0.0004]]] : [],
  centroid: at ?? null,
});
const village = (name: string): NisSettlement => ({
  id: nextId++,
  name,
  nameNorm: normalizeName(name),
  altNorms: [],
  kind: 'village',
  municipality: 'pantelej',
  lat: 1,
  lon: 1,
});

describe('resolveRow', () => {
  const anchor = street('Николе Пашића', [43.32, 21.9]);
  const near = street('Војводе Мишића', [43.322, 21.902]);
  const far = street('Живојина Мишића', [43.45, 22.2]);
  const trupale = village('Трупале');
  const deps = {
    resolver: new Resolver([anchor, near, far]),
    settlements: new StreetIndex([trupale]),
    municipality: 'medijana' as const,
  };

  it('resolves streets with the cheap steps in pass 1', () => {
    const [r] = resolveRow(splitUlice('Николе Пашића'), deps);
    expect(r).toMatchObject({ kind: 'street', by: 'exact', street: anchor });
  });

  it('uses the row’s own streets to place an ambiguous name (pass 2)', () => {
    const rows = resolveRow(splitUlice('Николе Пашића, Мишића'), deps);
    expect(rows[1]).toMatchObject({ by: 'scored', street: near });
  });

  it('leaves the same ambiguous name unresolved on a row without context, with candidates', () => {
    const [r] = resolveRow(splitUlice('Мишића'), deps);
    expect(r?.by).toBe('unresolved');
    expect(r?.street).toBeNull();
    expect(r?.candidates.map((c) => c.name).sort()).toEqual(['Војводе Мишића', 'Живојина Мишића']);
  });

  it('resolves village segments against the settlements', () => {
    const [r] = resolveRow(splitUlice('Део села Трупале'), deps);
    expect(r).toMatchObject({ kind: 'village', by: 'exact', settlement: trupale, street: null });
  });

  it('keeps unresolved villages with candidates', () => {
    const [r] = resolveRow(splitUlice('Део села Трупал'), deps);
    expect(r?.by).toBe('unresolved');
    expect(r?.settlement).toBeNull();
  });
});
