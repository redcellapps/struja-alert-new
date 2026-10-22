import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Where the scrape job gets EDS pages from. During development and in tests it reads the saved
// fixtures: only the fixture collector and the production scheduler may request
// elektrodistribucija.rs (BRIEF §0), and the production scheduler is the HttpPageSource below.
export interface FetchedPage {
  url: string;
  status: number;
  bytes: Uint8Array;
  etag: string | null;
}

export interface PageSource {
  // Day 0 = today ... 3. `null` = no such page (a 404, or nothing saved): the end of the days.
  // `etag` is the one stored from the previous fetch, for a conditional request.
  fetchPage(city: string, day: number, previousEtag?: string | null): Promise<FetchedPage | null>;
}

export const BASE = 'https://elektrodistribucija.rs';

export function pageUrl(city: string, day: number): string {
  return city === 'Beograd'
    ? `${BASE}/planirana-iskljucenja-beograd/Dan_${day}_Iskljucenja.htm`
    : `${BASE}/planirana-iskljucenja-srbija/${city}_Dan_${day}_Iskljucenja.htm`;
}

/** Reads the newest saved snapshot of `fixtures/eds` (the collector's output). */
export class FixturePageSource implements PageSource {
  private readonly dir: string;

  // No constructor parameter properties: Node's type stripping cannot run them.
  constructor(edsDir: string) {
    this.dir = edsDir;
  }

  private newestSlot(city: string, day: number): string | null {
    if (!existsSync(this.dir)) return null;
    const slots = readdirSync(this.dir)
      .filter((d) => !d.startsWith('_') && !d.endsWith('.json'))
      .sort()
      .reverse();
    for (const slot of slots) {
      if (existsSync(join(this.dir, slot, `${city}_Dan_${day}.htm`))) return slot;
    }
    return null;
  }

  async fetchPage(city: string, day: number): Promise<FetchedPage | null> {
    const slot = this.newestSlot(city, day);
    if (!slot) return null;
    const bytes = new Uint8Array(readFileSync(join(this.dir, slot, `${city}_Dan_${day}.htm`)));
    return { url: pageUrl(city, day), status: 200, bytes, etag: null };
  }
}

export interface HttpPageSourceOptions {
  userAgent: string;
  fetchFn?: typeof fetch;
  // Politeness: a pause before every request.
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The production source. A polite, identified client: a User-Agent that names the app and gives a
 * contact, a pause between requests, and conditional requests (`If-None-Match`) so an unchanged
 * page costs a 304. Never used in development or tests except with a fake `fetch`.
 */
export class HttpPageSource implements PageSource {
  private readonly o: Required<HttpPageSourceOptions>;

  constructor(options: HttpPageSourceOptions) {
    this.o = {
      userAgent: options.userAgent,
      fetchFn: options.fetchFn ?? fetch,
      delayMs: options.delayMs ?? 1500,
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  async fetchPage(
    city: string,
    day: number,
    previousEtag?: string | null,
  ): Promise<FetchedPage | null> {
    const url = pageUrl(city, day);
    await this.o.sleep(this.o.delayMs);
    const headers: Record<string, string> = { 'User-Agent': this.o.userAgent };
    if (previousEtag) headers['If-None-Match'] = previousEtag;
    const res = await this.o.fetchFn(url, { headers, redirect: 'follow' });
    if (res.status === 404) return null;
    const moved = res.url !== '' && new URL(res.url).pathname !== new URL(url).pathname;
    if (moved) return null; // redirected somewhere else: there is no such day
    const etag = res.headers.get('etag');
    if (res.status === 304)
      return { url, status: 304, bytes: new Uint8Array(), etag: previousEtag ?? etag };
    return { url, status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), etag };
  }
}

// The same rule as the collector: refuse to scrape without a contact address.
export function scraperUserAgent(version: string, email: string | undefined): string {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SCRAPER_CONTACT_EMAIL is required (a valid email) — refusing to scrape.');
  }
  return `StrujaAlert/${version} (+mailto:${email})`;
}
