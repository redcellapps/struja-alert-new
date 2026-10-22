import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fetchOverpass,
  NIS_QUERIES,
  OVERPASS_ENDPOINT,
  saveSnapshot,
  type FetchFn,
} from '../src/gazetteer/overpass.ts';

const UA = 'StrujaAlert/0.0.0 (+mailto:test@example.rs)';
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'osm-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('NIS_QUERIES', () => {
  it('has a long server timeout and asks for geometry only for streets', () => {
    for (const q of NIS_QUERIES) expect(q.query).toContain('[timeout:180]');
    const streets = NIS_QUERIES.find((q) => q.name === 'nis-streets');
    expect(streets?.query).toContain('out tags geom');
    expect(streets?.query).toContain('["highway"]["name"]');
  });
});

describe('fetchOverpass', () => {
  it('POSTs the query as form data with our User-Agent', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const f: FetchFn = async (url, init) => {
      seen = { url, init };
      return json({ elements: [{ type: 'way', id: 1 }] });
    };
    const r = await fetchOverpass('[out:json];out;', { userAgent: UA, fetchFn: f });
    expect(r.elements).toHaveLength(1);
    expect(seen?.url).toBe(OVERPASS_ENDPOINT);
    expect(seen?.init?.method).toBe('POST');
    expect((seen?.init?.headers as Record<string, string>)['User-Agent']).toBe(UA);
    expect(seen?.init?.body).toBe(`data=${encodeURIComponent('[out:json];out;')}`);
  });
  it('fails on non-200 responses', async () => {
    const f: FetchFn = async () => new Response('busy', { status: 429 });
    await expect(fetchOverpass('q', { userAgent: UA, fetchFn: f })).rejects.toThrow(/HTTP 429/);
  });
  it('fails on a 200 response that carries a runtime-error remark', async () => {
    const f: FetchFn = async () =>
      json({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1' });
    await expect(fetchOverpass('q', { userAgent: UA, fetchFn: f })).rejects.toThrow(/problem/);
  });
  it('fails when elements is missing', async () => {
    const f: FetchFn = async () => json({ hello: 1 });
    await expect(fetchOverpass('q', { userAgent: UA, fetchFn: f })).rejects.toThrow(/elements/);
  });
});

describe('saveSnapshot', () => {
  it('writes the raw JSON and a meta file with the query', async () => {
    const q = { name: 'nis-streets', query: '[out:json];out;' };
    const saved = await saveSnapshot(
      dir,
      q,
      { elements: [{ id: 1 }, { id: 2 }] },
      OVERPASS_ENDPOINT,
      new Date('2026-10-22T12:00:00Z'),
    );
    expect(saved.elements).toBe(2);
    expect(JSON.parse(await readFile(join(dir, 'nis-streets.json'), 'utf8')).elements).toHaveLength(
      2,
    );
    expect(JSON.parse(await readFile(join(dir, 'nis-streets.meta.json'), 'utf8'))).toMatchObject({
      fetched_at: '2026-10-22T12:00:00.000Z',
      elements: 2,
      query: '[out:json];out;',
    });
  });
});
