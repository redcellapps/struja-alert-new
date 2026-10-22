import { describe, expect, it } from 'vitest';
import { cyrillicToLatin, normalizeName } from '../src/index.ts';

describe('cyrillicToLatin', () => {
  it('maps digraph letters', () => {
    expect(cyrillicToLatin('љњџ')).toBe('ljnjdž');
    expect(cyrillicToLatin('ЉЊЏ')).toBe('LjNjDž');
  });
  it('maps the special letters', () => {
    expect(cyrillicToLatin('ђћчшж')).toBe('đćčšž');
  });
  it('leaves Latin, digits and punctuation alone', () => {
    expect(cyrillicToLatin('Bulevar 12. februara, 34a')).toBe('Bulevar 12. februara, 34a');
  });
});

describe('normalizeName', () => {
  it('matches the brief example', () => {
    expect(normalizeName('ВОЈВОДЕ МИШИЋА')).toBe('vojvode misica');
  });
  it('makes script and diacritics irrelevant', () => {
    const expected = 'vojvode misica';
    for (const v of ['Vojvode Mišića', 'vojvode misica', 'ВОЈВОДЕ МИШИЋА', 'Војводе Мишића']) {
      expect(normalizeName(v)).toBe(expected);
    }
  });
  it('folds đ to dj and џ to dz', () => {
    expect(normalizeName('Ђердапска')).toBe('djerdapska');
    expect(normalizeName('Џон Кенеди')).toBe('dzon kenedi');
  });
  it('expands abbreviations, including the dotless dr', () => {
    expect(normalizeName('Бул. Немањића')).toBe('bulevar nemanjica');
    expect(normalizeName('Нас. Габровац')).toBe('naselje gabrovac');
    expect(normalizeName('Ген. Радивоја Јанковића')).toBe('general radivoja jankovica');
    expect(normalizeName('Др Зорана Ђинђића')).toBe('doktor zorana djindjica');
    expect(normalizeName('Др. Зорана Ђинђића')).toBe('doktor zorana djindjica');
    expect(normalizeName('Св. Саве')).toBe('sveti save');
  });
  it('drops ul. and br. tokens', () => {
    expect(normalizeName('ул. Вука Караџића бр. 5')).toBe('vuka karadzica 5');
  });
  it('does not expand a bare word that is only an abbreviation when dotted', () => {
    expect(normalizeName('Нас')).toBe('nas');
  });
  it('drops a leading "ulica" only', () => {
    expect(normalizeName('Улица Кнеза Милоша')).toBe('kneza milosa');
    expect(normalizeName('Кнеза Милоша улица')).toBe('kneza milosa ulica');
  });
  it('collapses whitespace and punctuation', () => {
    expect(normalizeName('  12.   ФЕБРУАРА -  ')).toBe('12 februara');
    expect(normalizeName('')).toBe('');
  });
});
