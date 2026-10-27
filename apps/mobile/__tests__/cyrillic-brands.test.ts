import { transliterate } from '../src/i18n/cyrillic';

describe('transliteration keeps the names of the map data and the tile host', () => {
  it('leaves OpenStreetMap, OpenMapTiles, OpenFreeMap and IP in Latin', () => {
    expect(transliterate('Mape: © OpenStreetMap contributors, © OpenMapTiles, OpenFreeMap.')).toBe(
      'Мапе: © OpenStreetMap contributors, © OpenMapTiles, OpenFreeMap.',
    );
    expect(transliterate('vidi IP adresu')).toBe('види IP адресу');
  });

  it('still transliterates words that merely contain these letters', () => {
    expect(transliterate('Tip')).toBe('Тип');
  });
});
