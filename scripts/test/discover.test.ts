import { describe, expect, it } from 'vitest';
import { extractSlugs } from '../src/collector/discover.ts';

describe('extractSlugs', () => {
  it('finds distinct sorted city slugs from index links', () => {
    const html = `<a href="Nis_Dan_0_Iskljucenja.htm">a</a><a href="Nis_Dan_1_Iskljucenja.htm">b</a>
      <a href="Kraljevo_Dan_0_Iskljucenja.htm">c</a><a href="other.htm">x</a>`;
    expect(extractSlugs(html)).toEqual(['Kraljevo', 'Nis']);
  });
  it('keeps slugs that contain an underscore and ignores the slug-less Belgrade links', () => {
    const html = `<a href="/planirana-iskljucenja-srbija/Novi_Sad_Dan_2_Iskljucenja.htm">a</a>
      <a href="/planirana-iskljucenja-beograd/Dan_0_Iskljucenja.htm">b</a>`;
    expect(extractSlugs(html)).toEqual(['Novi_Sad']);
  });
  it('returns nothing when no links match', () => {
    expect(extractSlugs('<html></html>')).toEqual([]);
  });
});
