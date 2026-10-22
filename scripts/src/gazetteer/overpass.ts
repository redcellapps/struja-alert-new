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
    name: 'nis-admin-areas',
    query: `[out:json][timeout:180];${AREA}rel(area.a)["boundary"="administrative"]["admin_level"];out tags bb;`,
  },
];

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface OverpassResult {
  elements: unknown[];
  remark?: string;
  [key: string]: unknown;
}

export async function fetchOverpass(
  query: string,
  opts: { userAgent: string; fetchFn: FetchFn; endpoint?: string },
): Promise<OverpassResult> {
  const res = await opts.fetchFn(opts.endpoint ?? OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: {
      'User-Agent': opts.userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (res.status !== 200) {
    throw new Error(`Overpass returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
