import { toCyrillic, transliterate, type Tree } from '../src/i18n/cyrillic';
import { en } from '../src/i18n/en';
import { initI18n, localeCode, resources, i18next, setLocale } from '../src/i18n';
import { sr } from '../src/i18n/sr';

const keys = (tree: object, path = ''): string[] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${path}${k}`] : keys(v as object, `${path}${k}.`),
  );

describe('locales', () => {
  it('English and the generated Cyrillic have exactly the keys of the Serbian source', () => {
    expect(keys(en)).toEqual(keys(sr));
    expect(keys(resources['sr-Cyrl'].translation)).toEqual(keys(sr));
  });

  it('transliterates words and leaves {{placeholders}} alone', () => {
    expect(transliterate('Pratiću: {{address}}')).toBe('Пратићу: {{address}}');
    expect(transliterate('Ažurirano {{when}}')).toBe('Ажурирано {{when}}');
    expect(transliterate('Bez struje')).toBe('Без струје');
  });

  it('applies overrides by dotted key', () => {
    const tree: Tree = { a: { b: 'nj' }, c: 'nj' };
    expect(toCyrillic(tree, { 'a.b': 'њ!' })).toEqual({ a: { b: 'њ!' }, c: 'њ' });
  });

  it('keeps the same placeholders in every language', () => {
    const holes = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
    const flat = (t: object): Record<string, string> =>
      Object.fromEntries(
        keys(t).map((k) => [
          k,
          k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], t) as string,
        ]),
      );
    const base = flat(sr);
    for (const other of [flat(en), flat(resources['sr-Cyrl'].translation)]) {
      for (const k of Object.keys(base))
        expect(holes(other[k] as string)).toBe(holes(base[k] as string));
    }
  });

  it('maps language and script to a locale', () => {
    expect(localeCode('sr', 'latn')).toBe('sr-Latn');
    expect(localeCode('sr', 'cyrl')).toBe('sr-Cyrl');
    expect(localeCode('en', 'cyrl')).toBe('en');
  });
});

describe('i18next', () => {
  beforeAll(async () => {
    await initI18n('sr', 'latn');
  });

  it('uses the Serbian plural forms (one / few / other)', () => {
    const t = i18next.t.bind(i18next);
    expect(t('outages.count', { count: 1 })).toBe('1 isključenje');
    expect(t('outages.count', { count: 2 })).toBe('2 isključenja');
    expect(t('outages.count', { count: 5 })).toBe('5 isključenja');
    expect(t('outages.count', { count: 21 })).toBe('21 isključenje');
    expect(t('duration.hours', { count: 3 })).toBe('3 časa');
  });

  it('switches script and language at runtime', async () => {
    await setLocale('sr', 'cyrl');
    expect(i18next.t('tabs.home')).toBe('Почетна');
    await setLocale('en', 'latn');
    expect(i18next.t('tabs.home')).toBe('Home');
    await setLocale('sr', 'latn');
    expect(i18next.t('tabs.home')).toBe('Početna');
  });
});
