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

  it('serves the admin only with a long enough token, from loopback by default', () => {
    expect(loadConfig(base).ADMIN_TOKEN).toBeUndefined();
    expect(loadConfig(base).ADMIN_IP_ALLOWLIST).toBe('127.0.0.1,::1');
    expect(() => loadConfig({ ...base, ADMIN_TOKEN: 'short' })).toThrow(/ADMIN_TOKEN/);
    expect(loadConfig({ ...base, ADMIN_TOKEN: 'x'.repeat(16) }).ADMIN_TOKEN).toHaveLength(16);
  });

  it('email alerts need a sender and a recipient', () => {
    expect(() => loadConfig({ ...base, SMTP_URL: 'smtp://mail.example:587' })).toThrow(
      /ALERT_EMAIL/,
    );
    expect(
      loadConfig({
        ...base,
        SMTP_URL: 'smtp://mail.example:587',
        ALERT_EMAIL_FROM: 'a@example.rs',
        ALERT_EMAIL_TO: 'ops@example.rs',
      }).SMTP_URL,
    ).toBe('smtp://mail.example:587');
  });

  it('rejects nonsense values', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, PAGE_SOURCE: 'ftp' })).toThrow(/PAGE_SOURCE/);
    expect(() => loadConfig({ ...base, RUN_JOBS: 'yes' })).toThrow(/RUN_JOBS/);
  });
});
