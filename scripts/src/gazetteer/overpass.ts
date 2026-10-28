import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

// Niš as an area, by name in either script. The union can contain more than one administrative
// area (city, municipalities); `(area.a)` covers all of them and ids are deduplicated downstream.
const AREA = '(area["boundary"="administrative"]["name"~"^(Ниш|Niš|Град Ниш)$"];)->.a;';

export interface SnapshotQuery {
  name: string;
  query: string;
}

export const NIS_QUERIES: readonly SnapshotQuery[] = [
  {
    name: 'nis-streets',
    query: `[out:json][timeout:180];${AREA}way(area.a)["highway"]["name"];out tags geom;`,
  },
  {
    name: 'nis-address-points',
    query: `[out:json][timeout:180];${AREA}(node(area.a)["addr:street"]["addr:housenumber"];way(area.a)["addr:street"]["addr:housenumber"];);out tags center;`,
  },
  {
    // The settlements (admin_level 9: the villages, and the four urban parts "Ниш (Палилула)", ...)
    // with their boundaries: which settlement a street lies in.
    name: 'nis-settlement-areas',
    query: `[out:json][timeout:180];${AREA}rel(area.a)["boundary"="administrative"]["admin_level"="9"];out geom;`,
  },
  {
    name: 'nis-admin-areas',
    query: `[out:json][timeout:180];${AREA}rel(area.a)["boundary"="administrative"]["admin_level"];out tags bb;`,
  },
];

export interface Municipality {
  id: number;
  name: string;
}

// The five city municipalities are the admin_level=8 relations of the admin-areas snapshot.
export function pickMunicipalities(adminAreas: { elements: unknown[] }): Municipality[] {
  const out: Municipality[] = [];
  for (const raw of adminAreas.elements) {
    const e = raw as { type?: string; id?: number; tags?: Record<string, string> };
    if (e.type !== 'relation' || e.tags?.admin_level !== '8' || typeof e.id !== 'number') continue;
    out.push({ id: e.id, name: e.tags['name:sr-Latn'] ?? e.tags.name ?? String(e.id) });
  }
  return out.sort((a, b) => a.id - b.id);
}

// Which named street ways and place objects (village, hamlet, suburb, ...) lie inside one
// municipality. Street ways come back as ids only (their geometry is in nis-streets); places
// come with tags and a centre point.
export function municipalityQuery(relationId: number): SnapshotQuery {
  return {
    name: `nis-municipality-${relationId}`,
    query:
      `[out:json][timeout:180];rel(${relationId});map_to_area->.m;` +
      `way(area.m)["highway"]["name"];out ids;` +
      `(node(area.m)["place"~"^(village|hamlet|suburb|neighbourhood|town)$"];` +
      `way(area.m)["place"~"^(village|hamlet|suburb|neighbourhood|town)$"];);out tags center;`,
  };
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface OverpassResult {
  elements: unknown[];
  remark?: string;
  [key: string]: unknown;
}

// Busy server: the public instance answers 429/502/503/504 when its queue is full and asks
// clients to retry with exponential backoff.
const RETRYABLE = new Set([429, 502, 503, 504]);

export interface OverpassOptions {
  userAgent: string;
  fetchFn: FetchFn;
  endpoint?: string;
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export async function fetchOverpass(query: string, opts: OverpassOptions): Promise<OverpassResult> {
  const attempts = opts.attempts ?? 6;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let res: Response | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    res = await opts.fetchFn(opts.endpoint ?? OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'User-Agent': opts.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (res.status === 200 || !RETRYABLE.has(res.status) || attempt === attempts) break;
    const wait = (opts.baseDelayMs ?? 30_000) * 2 ** (attempt - 1);
    opts.log?.(
      `Overpass busy (HTTP ${res.status}); retry ${attempt}/${attempts - 1} in ${wait / 1000}s`,
    );
    await sleep(wait);
  }
  if (!res || res.status !== 200) {
    throw new Error(
      `Overpass returned HTTP ${res?.status}: ${((await res?.text()) ?? '').slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as OverpassResult;
  // Overpass reports timeouts and out-of-memory as a 200 with a `remark`, and a truncated result.
  if (json.remark && /error|timed out|out of memory/i.test(json.remark)) {
    throw new Error(`Overpass reported a problem: ${json.remark}`);
  }
  if (!Array.isArray(json.elements)) throw new Error('Overpass response has no elements array');
  return json;
}

export async function saveSnapshot(
  dir: string,
  q: SnapshotQuery,
  result: OverpassResult,
  endpoint: string,
  now: Date,
): Promise<{ file: string; elements: number }> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${q.name}.json`);
  await writeFile(file, JSON.stringify(result));
  await writeFile(
    join(dir, `${q.name}.meta.json`),
    JSON.stringify(
      {
        fetched_at: now.toISOString(),
        endpoint,
        query: q.query,
        elements: result.elements.length,
        osm3s: result.osm3s ?? null,
      },
      null,
      2,
    ) + '\n',
  );
  return { file, elements: result.elements.length };
}
