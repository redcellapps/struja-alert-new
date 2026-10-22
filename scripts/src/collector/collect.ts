import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractSlugs } from './discover.ts';
import { isAllowed, parseRobots } from './robots.ts';
import { currentSlot, manualSlot, type Slot } from './slots.ts';

export const BASE = 'https://elektrodistribucija.rs';
export const MAX_DAYS = 10;
export const BELGRADE = 'Beograd';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface CollectOptions {
  now: Date;
  force: boolean;
  fixturesDir: string;
  cities: string[];
  userAgent: string;
  fetchFn: FetchFn;
  delayMs: number;
  indexUrl: string;
  log: (msg: string) => void;
}

export interface PageRecord {
  city: string;
  n: number;
  status: number;
  bytes: number;
  sha256: string;
}

export interface SlotSummary {
  slot_key: string;
  started_at: string;
  finished_at: string;
  pages: PageRecord[];
  max_n: Record<string, number>;
  errors: string[];
}

export function buildUserAgent(version: string, email: string | undefined): string {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SCRAPER_CONTACT_EMAIL is required (a valid email) — refusing to run.');
  }
  return `StrujaAlert/${version} (+mailto:${email})`;
}

export function pageUrl(city: string, n: number): string {
  return city === BELGRADE
    ? `${BASE}/planirana-iskljucenja-beograd/Dan_${n}_Iskljucenja.htm`
    : `${BASE}/planirana-iskljucenja-srbija/${city}_Dan_${n}_Iskljucenja.htm`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

// Returns null when this slot is not due or is already collected.
export async function collectSlot(opts: CollectOptions): Promise<SlotSummary | null> {
  const slot: Slot | null = opts.force ? manualSlot(opts.now) : currentSlot(opts.now);
  if (!slot) {
    opts.log(
      'Outside the collection window (07/13/19 Europe/Belgrade, one hour each); nothing to do.',
    );
    return null;
  }
  const slotDir = join(opts.fixturesDir, 'eds', slot.key);
  const marker = join(slotDir, '_slot.json');
  if (await exists(marker)) {
    opts.log(`Slot ${slot.key} already collected; skipping.`);
    return null;
  }

  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const get = (url: string) =>
    opts.fetchFn(url, { headers: { 'User-Agent': opts.userAgent }, redirect: 'follow' });

  // robots.txt first. A missing file (4xx) means allowed; a network failure aborts the run.
  const robotsRes = await get(`${BASE}/robots.txt`);
  const rules = robotsRes.status === 200 ? parseRobots(await robotsRes.text(), 'StrujaAlert') : [];
  if (robotsRes.status >= 500) throw new Error(`robots.txt returned ${robotsRes.status}`);

  await mkdir(slotDir, { recursive: true });
  const pages: PageRecord[] = [];
  const maxN: Record<string, number> = {};

  const targets = [BELGRADE, ...opts.cities];
  for (const city of targets) {
    for (let n = 0; n < MAX_DAYS; n++) {
      const url = pageUrl(city, n);
      const path = new URL(url).pathname;
      if (!isAllowed(rules, path)) {
        errors.push(`robots.txt disallows ${path}`);
        break;
      }
      await sleep(opts.delayMs);
      let res: Response;
      try {
        res = await get(url);
      } catch (e) {
        errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      const moved = res.url !== '' && new URL(res.url).pathname !== path;
      if (res.status !== 200 || moved) {
        opts.log(
          `${city} day ${n}: stop (status ${res.status}${moved ? `, redirected to ${res.url}` : ''})`,
        );
        break;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const base = city === BELGRADE ? `Beograd_Dan_${n}` : `${city}_Dan_${n}`;
      await writeFile(join(slotDir, `${base}.htm`), bytes);
      await writeFile(
        join(slotDir, `${base}.meta.json`),
        JSON.stringify(
          {
            url,
            fetched_at: new Date().toISOString(),
            status: res.status,
            content_type: res.headers.get('content-type'),
            etag: res.headers.get('etag'),
            last_modified: res.headers.get('last-modified'),
            bytes: bytes.length,
            sha256,
            utf8_valid: isUtf8(bytes),
          },
          null,
          2,
        ) + '\n',
      );
      pages.push({ city, n, status: res.status, bytes: bytes.length, sha256 });
      maxN[city] = n;
    }
  }

  if (pages.length === 0) {
    throw new Error(
      `No pages collected for slot ${slot.key}: ${errors.join('; ') || 'all targets returned non-200'}`,
    );
  }

  // Once a day (first slot) or on a manual run: refresh the city slug list from the index page.
  if (opts.force || slot.hour === 7) {
    try {
      await sleep(opts.delayMs);
      const res = await get(opts.indexUrl);
      const html = res.status === 200 ? await res.text() : '';
      await mkdir(join(opts.fixturesDir, 'eds'), { recursive: true });
      await writeFile(
        join(opts.fixturesDir, 'eds', 'slugs.json'),
        JSON.stringify(
          {
            fetched_at: new Date().toISOString(),
            index_url: opts.indexUrl,
            status: res.status,
            slugs: extractSlugs(html),
          },
          null,
          2,
        ) + '\n',
      );
    } catch (e) {
      errors.push(`slug discovery: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const summary: SlotSummary = {
    slot_key: slot.key,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    pages,
    max_n: maxN,
    errors,
  };
  await writeFile(marker, JSON.stringify(summary, null, 2) + '\n');
  return summary;
}
