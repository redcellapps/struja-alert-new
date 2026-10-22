import { describe, expect, it } from 'vitest';
import { belgradeLocal, cyrillicToLatin, latinToCyrillic } from '../src/index.ts';

describe('latinToCyrillic', () => {
  it('maps plain letters and keeps case', () => {
    expect(latinToCyrillic('Sutra bez struje')).toBe('Сутра без струје');
    expect(latinToCyrillic('Izmena')).toBe('Измена');
  });
  it('treats lj, nj and dž as single letters', () => {
    expect(latinToCyrillic('ljubav njiva džep')).toBe('љубав њива џеп');
    expect(latinToCyrillic('Ljubica Njegoš Džon')).toBe('Љубица Његош Џон');
    expect(latinToCyrillic('LJUBICA NJEGOŠ DŽON')).toBe('ЉУБИЦА ЊЕГОШ ЏОН');
  });
  it('maps the Serbian letters with diacritics', () => {
    expect(latinToCyrillic('čćšžđ ČĆŠŽĐ')).toBe('чћшжђ ЧЋШЖЂ');
    expect(latinToCyrillic('Isključenje struje: Vojvode Mišića')).toBe(
      'Искључење струје: Војводе Мишића',
    );
  });
  it('does not turn "dj" into ђ (that is written đ)', () => {
    expect(latinToCyrillic('adjektiv')).toBe('адјектив');
  });
  it('leaves digits, punctuation and times alone', () => {
    expect(latinToCyrillic('08:30–12:30, br. 34a')).toBe('08:30–12:30, бр. 34а');
  });
  it('applies word overrides for words where lj/nj are two letters', () => {
    expect(latinToCyrillic('konjunkcija')).toBe('коњункција'); // wrong without an override
    expect(latinToCyrillic('konjunkcija', { konjunkcija: 'конјункција' })).toBe('конјункција');
    expect(latinToCyrillic('Injekcija', { injekcija: 'инјекција' })).toBe('Инјекција');
  });
  it('round-trips with cyrillicToLatin on ordinary words', () => {
    for (const w of ['Studenička', 'Bulevar', 'Čegarska', 'Njegoševa', 'Ljubomira']) {
      expect(cyrillicToLatin(latinToCyrillic(w))).toBe(w);
    }
  });
});

describe('belgradeLocal', () => {
  it('uses UTC+2 in summer and UTC+1 in winter', () => {
    expect(belgradeLocal(new Date('2026-10-22T06:30:00Z'))).toMatchObject({
      date: '2026-10-22',
      hour: 8,
      minute: 30,
      weekday: 4, // Thursday
    });
    expect(belgradeLocal(new Date('2026-12-01T07:30:00Z'))).toMatchObject({ hour: 8, minute: 30 });
  });
  it('rolls over to the next local day', () => {
    const l = belgradeLocal(new Date('2026-10-22T22:30:00Z')); // 00:30 CEST on the 23rd
    expect(l).toMatchObject({ date: '2026-10-23', hour: 0, minute: 30, weekday: 5 });
  });
  it('handles the end of summer time (25 Oct 2026)', () => {
    expect(belgradeLocal(new Date('2026-10-25T00:30:00Z')).hour).toBe(2); // still CEST
    expect(belgradeLocal(new Date('2026-10-25T01:30:00Z')).hour).toBe(2); // now CET: 02:30
    expect(belgradeLocal(new Date('2026-10-25T02:30:00Z')).hour).toBe(3);
  });
});
