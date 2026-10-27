import { i18next, initI18n } from '../src/i18n';

// The tile host sees the phone's IP address and the area shown: the privacy text says so, in every
// language, and the credits for the map data are in the About text.
describe.each([
  ['sr', 'latn'],
  ['sr', 'cyrl'],
  ['en', 'latn'],
] as const)('map text in %s %s', (language, script) => {
  beforeAll(async () => {
    await initI18n(language, script);
  });

  it('names OpenFreeMap in the privacy text and credits the map data in About', () => {
    expect(i18next.t('settings.privacyBody')).toContain('OpenFreeMap');
    expect(i18next.t('settings.privacyBody')).toContain('IP');
    const about = i18next.t('settings.aboutBody');
    for (const name of ['OpenStreetMap', 'OpenMapTiles', 'OpenFreeMap']) {
      expect(about).toContain(name);
    }
    expect(i18next.t('detail.mapSource')).toContain('OpenStreetMap');
  });
});
