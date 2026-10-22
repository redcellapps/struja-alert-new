import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'postgres://struja:struja@localhost:5432/struja' };

  it('has safe defaults: fixtures as the page source, jobs on, port 3000', () => {
    expect(loadConfig(base)).toMatchObject({
      PORT: 3000,
      RUN_JOBS: true,
      PAGE_SOURCE: 'fixtures',
      IMPORT_GAZETTEER: false,
    });
  });

  it('requires a database', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('never scrapes the live site without a contact address', () => {
    expect(() => loadConfig({ ...base, PAGE_SOURCE: 'http' })).toThrow(/SCRAPER_CONTACT_EMAIL/);
    expect(
      loadConfig({ ...base, PAGE_SOURCE: 'http', SCRAPER_CONTACT_EMAIL: 'ops@example.rs' })
        .PAGE_SOURCE,
    ).toBe('http');
  });

  it('rejects nonsense values', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, PAGE_SOURCE: 'ftp' })).toThrow(/PAGE_SOURCE/);
    expect(() => loadConfig({ ...base, RUN_JOBS: 'yes' })).toThrow(/RUN_JOBS/);
  });
});
