import { describe, expect, it } from 'vitest';
import { extractSlugs } from '../src/collector/discover.ts';

describe('extractSlugs', () => {
  it('finds distinct sorted city slugs from index links', () => {
    const html = `<a href="Nis_Dan_0_Iskljucenja.htm">a</a><a href="Nis_Dan_1_Iskljucenja.htm">b</a>
      <a href="Kraljevo_Dan_0_Iskljucenja.htm">c</a><a href="other.htm">x</a>`;
    expect(extractSlugs(html)).toEqual(['Kraljevo', 'Nis']);
  });
  it('returns nothing when no links match', () => {
    expect(extractSlugs('<html></html>')).toEqual([]);
  });
});
