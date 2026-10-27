import { describe, expect, it } from 'vitest';
import { assertLocalDatabase } from '../src/dev/local-only.ts';

describe('development tools only run against a local database', () => {
  it.each([
    'postgres://struja:struja@localhost:5432/struja',
    'postgres://struja:struja@127.0.0.1:5432/struja',
    'postgresql://struja@localhost/struja?sslmode=disable',
  ])('accepts %s', (url) => {
    expect(() => assertLocalDatabase(url, 'dev:scrape')).not.toThrow();
  });

  it.each([
    [undefined, 'is not set'],
    ['', 'is not set'],
    ['not a url', 'not a valid URL'],
    ['mysql://struja@localhost/struja', 'not a postgres://'],
    ['postgres://struja:pw@db.example.com:5432/struja', 'db.example.com'],
    ['postgres://struja:pw@10.0.0.5:5432/struja', '10.0.0.5'],
    // lookalikes and tricks: only the parsed host counts
    ['postgres://struja:pw@localhost.example.com/struja', 'localhost.example.com'],
    ['postgres://localhost:pw@prod.example.com/struja', 'prod.example.com'],
    ['postgres://struja@localhost/struja?host=prod.example.com', 'host override'],
    ['postgres://struja@localhost/struja?hostaddr=10.0.0.5', 'host override'],
  ])('refuses %s', (url, why) => {
    expect(() => assertLocalDatabase(url, 'dev:scrape')).toThrow(
      new RegExp(`dev:scrape is a development tool.*${why}`),
    );
  });

  it('names the tool and says what to set', () => {
    expect(() => assertLocalDatabase('postgres://u@prod.example.com/x', 'dev:fixtures')).toThrow(
      /dev:fixtures.*localhost or 127\.0\.0\.1/,
    );
  });
});
