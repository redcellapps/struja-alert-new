import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildUserAgent,
  collectSlot,
  pageUrl,
  type CollectOptions,
  type FetchFn,
} from '../src/collector/collect.ts';

const IN_SLOT = new Date('2026-10-24T05:10:00Z'); // 07:10 Belgrade (CEST)
const OUT_OF_SLOT = new Date('2026-10-24T06:10:00Z'); // 08:10
const UA = 'StrujaAlert/0.0.0 (+mailto:test@example.rs)';
const BODY = [0xd0, 0x9d, 0xd0, 0x98, 0xd0, 0xa8];

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'collector-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeFetch(days: number, calls: string[] = []): FetchFn {
  return async (url, init) => {
    calls.push(`${url}|${(init?.headers as Record<string, string>)['User-Agent']}`);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /admin/\n');
    if (url.endsWith('/planirana-iskljucenja-srbija/')) {
      return new Response('<a href="Nis_Dan_0_Iskljucenja.htm">x</a>');
    }
    const m = /Dan_(\d+)_Iskljucenja\.htm$/.exec(url);
    if (m && Number(m[1]) < days) {
      return new Response(new Uint8Array(BODY), {
        status: 200,
        headers: { etag: '"abc"', 'content-type': 'text/html' },
      });
    }
    return new Response('not found', { status: 404 });
  };
}

const opts = (over: Partial<CollectOptions> = {}): CollectOptions => ({
  now: IN_SLOT,
  force: false,
  fixturesDir: dir,
  cities: ['Nis'],
  userAgent: UA,
  fetchFn: fakeFetch(3),
  delayMs: 0,
  indexUrl: 'https://elektrodistribucija.rs/planirana-iskljucenja-srbija/',
  log: () => {},
  ...over,
});

describe('buildUserAgent', () => {
  it('embeds the contact email', () => {
    expect(buildUserAgent('1.2.3', 'me@example.rs')).toBe(
      'StrujaAlert/1.2.3 (+mailto:me@example.rs)',
    );
  });
  it('refuses to run without a valid email', () => {
    expect(() => buildUserAgent('1.0.0', undefined)).toThrow(/SCRAPER_CONTACT_EMAIL/);
    expect(() => buildUserAgent('1.0.0', 'not-an-email')).toThrow(/SCRAPER_CONTACT_EMAIL/);
  });
});

describe('pageUrl', () => {
  it('builds Serbia and Belgrade URLs', () => {
    expect(pageUrl('Nis', 2)).toBe(
      'https://elektrodistribucija.rs/planirana-iskljucenja-srbija/Nis_Dan_2_Iskljucenja.htm',
    );
    expect(pageUrl('Beograd', 0)).toBe(
      'https://elektrodistribucija.rs/planirana-iskljucenja-beograd/Dan_0_Iskljucenja.htm',
    );
  });
});

describe('collectSlot', () => {
  it('does nothing outside the window', async () => {
    const calls: string[] = [];
    expect(await collectSlot(opts({ now: OUT_OF_SLOT, fetchFn: fakeFetch(3, calls) }))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('saves raw bytes + meta, stops at the first non-200 day, records max N, sends the UA', async () => {
    const calls: string[] = [];
    const summary = await collectSlot(opts({ fetchFn: fakeFetch(3, calls) }));
    expect(summary?.slot_key).toBe('2026-10-24-07');
    expect(summary?.max_n).toEqual({ Beograd: 2, Nis: 2 });
    const slotDir = join(dir, 'eds', '2026-10-24-07');
    const files = await readdir(slotDir);
    expect(files).toContain('Nis_Dan_2.htm');
    expect(files).toContain('Beograd_Dan_0.meta.json');
    expect(files).not.toContain('Nis_Dan_3.htm');
    expect([...(await readFile(join(slotDir, 'Nis_Dan_0.htm')))]).toEqual(BODY);
    const meta = JSON.parse(await readFile(join(slotDir, 'Nis_Dan_0.meta.json'), 'utf8'));
    expect(meta).toMatchObject({ status: 200, etag: '"abc"', utf8_valid: true, bytes: 6 });
    expect(calls.every((c) => c.endsWith(`|${UA}`))).toBe(true);
  });

  it('dedupes per slot: a second run in the same slot fetches nothing', async () => {
    await collectSlot(opts());
    const calls: string[] = [];
    const again = await collectSlot(
      opts({ now: new Date('2026-10-24T05:50:00Z'), fetchFn: fakeFetch(3, calls) }),
    );
    expect(again).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('collects again in the next slot', async () => {
    await collectSlot(opts());
    const next = await collectSlot(opts({ now: new Date('2026-10-24T11:10:00Z') }));
    expect(next?.slot_key).toBe('2026-10-24-13');
  });

  it('refreshes the slug list on the 07 slot only', async () => {
    await collectSlot(opts());
    const slugs = JSON.parse(await readFile(join(dir, 'eds', 'slugs.json'), 'utf8'));
    expect(slugs.slugs).toEqual(['Nis']);
    await rm(join(dir, 'eds', 'slugs.json'));
    await collectSlot(opts({ now: new Date('2026-10-24T11:10:00Z') }));
    await expect(readFile(join(dir, 'eds', 'slugs.json'))).rejects.toThrow();
  });

  it('manual runs bypass the window and use their own key', async () => {
    const s = await collectSlot(opts({ now: OUT_OF_SLOT, force: true }));
    expect(s?.slot_key).toBe('manual-20261024T0610Z');
  });

  it('fails without writing the slot marker when nothing was collected, so a retry works', async () => {
    await expect(collectSlot(opts({ fetchFn: fakeFetch(0) }))).rejects.toThrow(
      /No pages collected/,
    );
    const retry = await collectSlot(opts({ fetchFn: fakeFetch(1) }));
    expect(retry?.pages.length).toBeGreaterThan(0);
  });

  it('respects robots.txt', async () => {
    const f: FetchFn = async (url) => {
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /planirana-iskljucenja-srbija/\n');
      }
      return new Response('x', { status: 200 });
    };
    const s = await collectSlot(opts({ fetchFn: f }));
    expect(s?.pages.every((p) => p.city === 'Beograd')).toBe(true);
    expect(s?.errors.some((e) => e.includes('robots.txt disallows'))).toBe(true);
  });

  it('treats a redirect to a different path as "no such day"', async () => {
    const f: FetchFn = async (url) => {
      if (url.endsWith('/robots.txt')) return new Response('');
      if (url.includes('Nis_Dan_1')) {
        const r = new Response('home page', { status: 200 });
        Object.defineProperty(r, 'url', { value: 'https://elektrodistribucija.rs/' });
        return r;
      }
      return new Response('x', { status: url.includes('Dan_0') ? 200 : 404 });
    };
    const s = await collectSlot(opts({ fetchFn: f }));
    expect(s?.max_n.Nis).toBe(0);
  });
});
