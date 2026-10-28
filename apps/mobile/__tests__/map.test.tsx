/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must use require */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { OutageDetailDto } from '@struja/shared';
import { Linking } from 'react-native';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { initI18n } from '../src/i18n';
import { palettes } from '../src/design/tokens';
import { MAP_CONFIG } from '../src/map/config';
import { isTileNetworkFailure } from '../src/map/logging';
import { boundsOf, drawable } from '../src/map/geo';
import { OutageMap } from '../src/map/OutageMap';
import { BASE_LAYER_IDS, buildMapStyle, labelField, mapColors } from '../src/map/style';

// What the native map reports: the tests drive its events and its answer to "what is drawn".
const mockMap: {
  props: Record<string, (...a: unknown[]) => void>;
  query: jest.Mock;
  camera: { props: Record<string, unknown>; fitBounds: jest.Mock };
} = { props: {}, query: jest.fn(), camera: { props: {}, fitBounds: jest.fn() } };
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stub = ({ children }: { children?: unknown }) => children ?? null;
  const Map = React.forwardRef(
    (props: Record<string, (...a: unknown[]) => void> & { children?: unknown }, ref: unknown) => {
      mockMap.props = props;
      React.useImperativeHandle(ref, () => ({ queryRenderedFeatures: mockMap.query }));
      return React.createElement(View, { testID: 'native-map' }, props.children);
    },
  );
  return {
    __esModule: true,
    Map,
    Camera: React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockMap.camera.props = props;
      React.useImperativeHandle(ref, () => ({ fitBounds: mockMap.camera.fitBounds }));
      return null;
    }),
    GeoJSONSource: Stub,
    Layer: Stub,
    LogManager: { onLog: () => undefined },
  };
});

const street: GeoJSON.Feature = {
  type: 'Feature',
  properties: { name: 'Требињска' },
  geometry: {
    type: 'MultiLineString',
    coordinates: [
      [
        [21.8758, 43.3043],
        [21.8754, 43.3064],
      ],
    ],
  },
};
const geometry = (features: GeoJSON.Feature[]): OutageDetailDto['geometry'] => ({
  type: 'FeatureCollection',
  features,
});

const show = (ui: React.ReactElement, name: 'light' | 'dark' = 'light') =>
  render(<ThemeProvider override={buildTheme(name)}>{ui}</ThemeProvider>);

describe('map style', () => {
  it('reads the tiles and the glyphs from the config, so the host can be changed in one place', () => {
    const style = buildMapStyle(mapColors(palettes.standard.light, 'light'), 'latn');
    expect(style.sources['openmaptiles']).toEqual({ type: 'vector', url: MAP_CONFIG.tilesUrl });
    expect(style.glyphs).toBe(MAP_CONFIG.glyphsUrl);
    expect(MAP_CONFIG.tilesUrl).toContain('openfreemap.org');
  });

  it('has the layers the "is the base map drawn" check looks for', () => {
    const style = buildMapStyle(mapColors(palettes.standard.light, 'light'), 'latn');
    const ids = style.layers.map((l) => l.id);
    for (const id of BASE_LAYER_IDS) expect(ids).toContain(id);
  });

  it('labels follow the script: Latin with diacritics first, or Cyrillic first, then the local name', () => {
    expect(labelField('latn')).toEqual([
      'coalesce',
      ['get', 'name:sr-Latn'],
      ['get', 'name:latin'],
      ['get', 'name'],
    ]);
    expect(labelField('cyrl')).toEqual([
      'coalesce',
      ['get', 'name:sr'],
      ['get', 'name:nonlatin'],
      ['get', 'name'],
    ]);
    const cyrl = buildMapStyle(mapColors(palettes.standard.light, 'light'), 'cyrl');
    const roadLabel = JSON.stringify(cyrl.layers.find((l) => l.id === 'road-label'));
    expect(roadLabel).toContain('name:sr');
    expect(roadLabel).not.toContain('name:sr-Latn');
  });

  // MapLibre drops a layer whose zoom expression is not the input of a top-level interpolate or step
  // (found on the emulator: the road casings were wrapped in an addition).
  it.each(['light', 'dark'] as const)(
    'uses zoom only at the top of an interpolate or step (%s)',
    (name) => {
      const style = buildMapStyle(mapColors(palettes.standard[name], name), 'latn');
      const bad: string[] = [];
      for (const layer of style.layers as unknown as Record<string, Record<string, unknown>>[]) {
        for (const group of ['paint', 'layout']) {
          for (const [prop, value] of Object.entries(layer[group] ?? {})) {
            const uses = JSON.stringify(value).includes('"zoom"');
            const ok = Array.isArray(value) && ['interpolate', 'step'].includes(String(value[0]));
            if (uses && !ok) bad.push(`${String(layer['id'])}.${prop}`);
          }
        }
      }
      expect(bad).toEqual([]);
    },
  );

  it('has a light and a dark variant that follow the palette', () => {
    const light = mapColors(palettes.standard.light, 'light');
    const dark = mapColors(palettes.standard.dark, 'dark');
    expect(light.land).toBe(palettes.standard.light.chrome.raised);
    expect(light.road).toBe(palettes.standard.light.chrome.card);
    expect(dark.land).toBe(palettes.standard.dark.chrome.card);
    expect(dark.text).toBe(palettes.standard.dark.chrome.text);
    expect(light.land).not.toBe(dark.land);
    const background = (c: typeof light) =>
      (buildMapStyle(c, 'latn').layers[0] as unknown as { paint: Record<string, string> }).paint[
        'background-color'
      ];
    expect(background(light)).toBe(light.land);
    expect(background(dark)).toBe(dark.land);
  });
});

describe('map geometry', () => {
  it('keeps only features that have coordinates', () => {
    const empty: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiLineString', coordinates: [] },
    };
    expect(drawable(geometry([street, empty]))).toEqual([street]);
    expect(drawable(geometry([]))).toEqual([]);
  });

  it('bounds the street and the house, and never zooms a lone point to a rooftop', () => {
    const b = boundsOf([street], null);
    expect(b?.[0]).toBeCloseTo(21.8756 - 0.002, 5); // widened to the minimum, centred on the street
    expect(b?.[1]).toBeCloseTo(43.30535 - 0.002, 5);
    expect(b?.[3]).toBeCloseTo(43.30535 + 0.002, 5);
    const withHouse = boundsOf([street], { lng: 21.9, lat: 43.31 });
    expect(withHouse?.[2]).toBe(21.9);
    expect(withHouse?.[3]).toBe(43.31);
    const point: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [21.9, 43.3] },
    };
    const lone = boundsOf([point], null);
    expect((lone?.[2] ?? 0) - (lone?.[0] ?? 0)).toBeGreaterThanOrEqual(0.004 - 1e-9);
    expect(boundsOf([], null)).toBeNull();
  });
});

describe('OutageMap', () => {
  beforeAll(async () => {
    await initI18n('sr', 'latn');
  });
  beforeEach(() => {
    jest.useFakeTimers();
    mockMap.query.mockReset();
    mockMap.props = {};
  });
  afterEach(() => jest.useRealTimers());

  const props = {
    geometry: geometry([street]),
    house: { lng: 21.8757, lat: 43.305 },
    color: '#DC2F34',
    script: 'latn' as const,
  };
  const tick = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  };

  it('shows a placeholder while it loads, then the map with its credits once tiles are in view', async () => {
    mockMap.query.mockResolvedValue([{ id: 1 }]);
    await show(<OutageMap {...props} />);
    expect(screen.getByLabelText('Učitavanje')).toBeTruthy();
    expect(screen.queryByText(MAP_CONFIG.attributionText)).toBeNull();
    await act(async () => mockMap.props['onDidFinishLoadingStyle']?.());
    await tick(700);
    expect(screen.queryByLabelText('Učitavanje')).toBeNull();
    expect(screen.getByText('© OpenStreetMap · © OpenMapTiles · OpenFreeMap')).toBeTruthy();
    expect(screen.getByRole('link').props.accessibilityLabel).toContain('OpenStreetMap');
  });

  it('opens the OSM copyright page from the credits', async () => {
    mockMap.query.mockResolvedValue([{ id: 1 }]);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    await show(<OutageMap {...props} />);
    await act(async () => mockMap.props['onDidFinishLoadingStyle']?.());
    await tick(700);
    await act(async () => {
      fireEvent.press(screen.getByRole('link'));
    });
    expect(open).toHaveBeenCalledWith('https://www.openstreetmap.org/copyright');
  });

  it('is a still picture: no pan, zoom or rotate', async () => {
    await show(<OutageMap {...props} />);
    const p = mockMap.props as Record<string, unknown>;
    for (const key of ['dragPan', 'touchZoom', 'doubleTapZoom', 'touchRotate', 'touchPitch']) {
      expect(p[key]).toBe(false);
    }
  });

  it('renders nothing when the map fails to load', async () => {
    await show(<OutageMap {...props} />);
    await act(async () => mockMap.props['onDidFailLoadingMap']?.());
    expect(screen.queryByTestId('outage-map')).toBeNull();
  });

  it('renders nothing when no tile is in view in time (a failing tile host)', async () => {
    mockMap.query.mockResolvedValue([]);
    await show(<OutageMap {...props} />);
    await act(async () => mockMap.props['onDidFinishLoadingStyle']?.());
    await tick(MAP_CONFIG.timeoutMs - 1000);
    expect(screen.getByTestId('outage-map')).toBeTruthy(); // still waiting: a placeholder, not a blank map
    await tick(2000);
    expect(screen.queryByTestId('outage-map')).toBeNull();
  });

  describe('where the view starts', () => {
    const line = (streetId: number, a: [number, number], b: [number, number]): GeoJSON.Feature => ({
      type: 'Feature',
      properties: { streetId, name: `street ${streetId}` },
      geometry: { type: 'MultiLineString', coordinates: [[a, b]] },
    });
    // street 1 is the person's; street 2 is 5 km away: the outage is both
    const own = line(1, [21.9, 43.3], [21.904, 43.304]);
    const other = line(2, [21.96, 43.35], [21.964, 43.354]);
    const outage = geometry([own, other]);
    const house = { lng: 21.902, lat: 43.302 };
    const ready = async () => {
      mockMap.query.mockResolvedValue([{ id: 1 }]);
      await act(async () => mockMap.props['onDidFinishLoadingStyle']?.());
      await tick(700);
    };
    const startBounds = () =>
      (mockMap.camera.props['initialViewState'] as { bounds: [number, number, number, number] })
        .bounds;
    const width = (b: number[]) => (b[2] as number) - (b[0] as number);

    beforeEach(() => mockMap.camera.fitBounds.mockReset());

    it('starts on the person’s house, with a button for the whole outage', async () => {
      await show(<OutageMap {...props} geometry={outage} house={house} ownStreetIds={[1]} />);
      // about 400 m around the house, not the 6 km of the outage
      expect(width(startBounds())).toBeCloseTo(0.004, 3);
      expect((startBounds()[0] + startBounds()[2]) / 2).toBeCloseTo(house.lng, 4);
      await ready();
      await act(async () => fireEvent.press(screen.getByText('Celo isključenje')));
      const whole = mockMap.camera.fitBounds.mock.calls[0]?.[0] as number[];
      expect(whole[0]).toBeLessThanOrEqual(21.9);
      expect(whole[2]).toBeGreaterThanOrEqual(21.964); // street 2 is in view now
      // and back to the house
      expect(screen.getByText('Moja adresa')).toBeTruthy();
      await act(async () => fireEvent.press(screen.getByText('Moja adresa')));
      const back = mockMap.camera.fitBounds.mock.calls[1]?.[0] as number[];
      expect(width(back)).toBeCloseTo(0.004, 3);
    });

    it('without a house number starts on the street of the address, not on the candidates of another name', async () => {
      const candidate = { ...line(3, [21.5, 43.1], [21.52, 43.12]) };
      (candidate.properties as Record<string, unknown>)['candidate'] = true;
      await show(
        <OutageMap
          {...props}
          geometry={geometry([own, other, candidate])}
          house={null}
          ownStreetIds={[1, 3]}
        />,
      );
      const b = startBounds();
      expect(b[0]).toBeGreaterThan(21.89);
      expect(b[2]).toBeLessThan(21.92); // street 1 only
      await ready();
      expect(screen.getByText('Celo isključenje')).toBeTruthy();
    });

    it('shows the whole outage, and no button, when the person has no address in it', async () => {
      await show(<OutageMap {...props} geometry={outage} house={null} ownStreetIds={[]} />);
      expect(startBounds()[2]).toBeGreaterThanOrEqual(21.964);
      await ready();
      expect(screen.queryByText('Celo isključenje')).toBeNull();
    });

    it('has no button when the view would hardly change (a single small street)', async () => {
      await show(
        <OutageMap {...props} geometry={geometry([own])} house={house} ownStreetIds={[1]} />,
      );
      await ready();
      expect(screen.queryByText('Celo isključenje')).toBeNull();
    });
  });

  it('renders nothing when the style never loads', async () => {
    await show(<OutageMap {...props} />);
    await tick(MAP_CONFIG.timeoutMs + 1000);
    expect(screen.queryByTestId('outage-map')).toBeNull();
  });

  it('renders nothing when there is nothing to draw', async () => {
    await show(<OutageMap {...props} geometry={geometry([])} house={null} />);
    expect(screen.queryByTestId('outage-map')).toBeNull();
  });
});

describe('native map logging', () => {
  it('treats failed tile requests as expected, and a broken style as a real problem', () => {
    const log = (message: string, tag = 'Mbgl') => ({ level: 'error', tag, message });
    expect(
      isTileNetworkFailure(
        log(
          '{ple.strujaalert}[Style]: Failed to load source openmaptiles: Failed to connect to /10.0.2.2:9',
        ),
      ),
    ).toBe(true);
    expect(
      isTileNetworkFailure(log('Request failed due to a temporary error', 'Mbgl-HttpRequest')),
    ).toBe(true);
    expect(
      isTileNetworkFailure(
        log(
          '[ParseStyle]: "zoom" expression may only be used as input to a top-level "step" or "interpolate" expression.',
        ),
      ),
    ).toBe(false);
  });
});
