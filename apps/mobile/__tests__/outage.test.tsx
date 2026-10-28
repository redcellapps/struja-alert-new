import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform, Share } from 'react-native';
import type { OutageDetailDto } from '@struja/shared';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { i18next, initI18n } from '../src/i18n';
import {
  addToCalendar,
  calendarEvent,
  dateLong,
  shareMessage,
  shareOutage,
  windowText,
} from '../src/outage/actions';
import {
  OutageDetailView,
  type DetailAddress,
  type OutageDetailViewProps,
} from '../src/outage/OutageDetailView';
import {
  addressRanges,
  rangeContains,
  rangeLabel,
  segmentForStreet,
  streetLine,
} from '../src/outage/ranges';

const mockStart = jest.fn();
jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: (...a: unknown[]) => mockStart(...a),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
const t = i18next.t.bind(i18next) as (k: string, o?: Record<string, unknown>) => string;

// Belgrade is UTC+1 in November: 06:00 on Tuesday 3 November 2026.
const NOW = new Date('2026-11-03T05:00:00Z');

const detail = (over: Partial<OutageDetailDto> = {}): OutageDetailDto => ({
  id: 1001,
  city: 'nis',
  municipality: 'Медијана',
  outageDate: '2026-11-03',
  startsAt: '2026-11-03T07:30:00Z',
  endsAt: '2026-11-03T11:30:00Z',
  status: 'active',
  revision: 0,
  rawStreets: 'Војводе Мишића (непарни од 1 до 41), делови Студеничке;',
  segments: [
    {
      raw: 'Војводе Мишића (непарни од 1 до 41)',
      kind: 'street',
      name: { latin: 'Vojvode Mišića', cyrillic: 'Војводе Мишића' },
      streetId: 1,
      partial: false,
      ranges: [
        { raw: 'непарни од 1 до 41', from: 1, to: 41, parity: 'odd' },
        { raw: '50–60', from: 50, to: 60, parity: null },
      ],
    },
    {
      raw: 'делови Студеничке',
      kind: 'street',
      name: { latin: 'Studenička', cyrillic: 'Студеничка' },
      streetId: 2,
      partial: true,
      ranges: [],
    },
    {
      raw: 'Космајска',
      kind: 'street',
      name: { latin: 'Kosmajska', cyrillic: 'Космајска' },
      streetId: 3,
      partial: false,
      ranges: [],
    },
    { raw: 'неки део', kind: 'unresolved', name: null, streetId: null, partial: false, ranges: [] },
  ],
  geometry: { type: 'FeatureCollection', features: [] },
  source: { name: 'Elektrodistribucija Srbije', url: 'https://example.test/eds' },
  mine: [],
  ...over,
});

const mine = (over: Partial<DetailAddress> = {}): DetailAddress => ({
  subscriptionId: 1,
  streetId: 1,
  label: 'Kuća',
  street: { latin: 'Vojvode Mišića', cyrillic: 'Војводе Мишића' },
  name: 'Vojvode Mišića 35',
  houseNumber: 35,
  match: 'affected',
  reason: null,
  ...over,
});

describe('ranges', () => {
  const odd = { raw: 'x', from: 1, to: 41, parity: 'odd' as const };
  const even = { raw: 'x', from: 2, to: 40, parity: 'even' as const };

  it('respects the bounds and the odd/even rule', () => {
    expect(rangeContains(odd, 1)).toBe(true);
    expect(rangeContains(odd, 41)).toBe(true);
    expect(rangeContains(odd, 43)).toBe(false);
    expect(rangeContains(odd, 34)).toBe(false); // even number, odd range
    expect(rangeContains(even, 34)).toBe(true);
    expect(rangeContains({ raw: '', from: 26, to: 40, parity: null }, 34)).toBe(true);
    expect(rangeContains({ raw: '', from: 50, to: null, parity: null }, 99)).toBe(true);
    expect(rangeContains({ raw: '', from: null, to: 10, parity: null }, 11)).toBe(false);
  });

  it('labels ranges', () => {
    expect(rangeLabel(odd, t)).toBe('neparni 1–41');
    expect(rangeLabel(even, t)).toBe('parni 2–40');
    expect(rangeLabel({ raw: '', from: 26, to: 40, parity: null }, t)).toBe('26–40');
    expect(rangeLabel({ raw: '', from: 5, to: 5, parity: null }, t)).toBe('5');
    expect(rangeLabel({ raw: '', from: 50, to: null, parity: null }, t)).toBe('od 50');
    expect(rangeLabel({ raw: 'cela', from: null, to: null, parity: null }, t)).toBe('cela');
  });

  it('finds the segment of a street by its normalized name, in any script', () => {
    const d = detail();
    expect(segmentForStreet(d.segments, { latin: 'VOJVODE MIŠIĆA', cyrillic: '' })?.raw).toMatch(
      /^Војводе/,
    );
    expect(segmentForStreet(d.segments, { latin: 'Nema takve', cyrillic: '' })).toBeUndefined();
  });

  it('highlights the range that holds the number and says so', () => {
    const seg = detail().segments[0];
    const info = addressRanges(seg, 35, 'affected', null, t);
    expect(info.chips).toEqual([
      { label: 'neparni 1–41', contains: true },
      { label: '50–60', contains: false },
    ]);
    expect(info.note).toBe('Vaš broj 35 je u opsegu neparni 1–41');
    expect(info.askForNumber).toBe(false);
  });

  it('a possible match without a number says why and asks for the number', () => {
    const info = addressRanges(detail().segments[0], null, 'possible', 'no_number', t);
    expect(info.note).toBe('Moguće pogođeno — niste uneli broj');
    expect(info.askForNumber).toBe(true);
    expect(info.chips.every((c) => !c.contains)).toBe(true);
  });

  it('says plainly that several streets share the name and the notice does not say which', () => {
    // the segment of an ambiguous name is not one street, so there is nothing to show but the doubt
    const info = addressRanges(undefined, 12, 'possible', 'same_name', t);
    expect(info.note).toBe(t('detail.possibleSameName'));
    expect(info.note).toMatch(/Više ulica/);
    expect(info.askForNumber).toBe(false);
  });

  it('a partial or unresolved doubt does not ask for a number', () => {
    const info = addressRanges(detail().segments[1], 7, 'possible', 'partial', t);
    expect(info.note).toBe('Moguće pogođeno');
    expect(info.askForNumber).toBe(false);
    expect(info.chips).toEqual([{ label: 'delovi ulice', contains: false }]);
  });

  it('a whole street has no ranges and no doubt', () => {
    const info = addressRanges(detail().segments[2], 3, 'affected', null, t);
    expect(info.chips).toEqual([{ label: 'cela ulica', contains: false }]);
    expect(info.note).toBe('Isključenje obuhvata celu ulicu.');
  });

  it('lines for the street list', () => {
    const segs = detail().segments;
    expect(streetLine(segs[0]!, 'latn', t)).toEqual({
      title: 'Vojvode Mišića',
      detail: 'neparni 1–41, 50–60',
    });
    expect(streetLine(segs[0]!, 'cyrl', t).title).toBe('Војводе Мишића');
    expect(streetLine(segs[1]!, 'latn', t).detail).toBe('delovi ulice');
    expect(streetLine(segs[3]!, 'latn', t)).toEqual({ title: 'неки део', detail: null });
  });
});

describe('actions', () => {
  it('writes dates and windows', () => {
    expect(dateLong('2026-11-03', t)).toBe('utorak, 3. novembar');
    expect(dateLong('2026-12-31', t)).toBe('četvrtak, 31. decembar');
    expect(windowText(detail())).toBe('08:30–12:30');
  });

  it('builds the calendar event from the outage', () => {
    const e = calendarEvent(detail(), 'Vojvode Mišića 35', t);
    expect(e).toMatchObject({
      title: 'Isključenje struje',
      begin: Date.parse('2026-11-03T07:30:00Z'),
      end: Date.parse('2026-11-03T11:30:00Z'),
      location: 'Vojvode Mišića 35',
    });
    expect(e.description).toContain('https://example.test/eds');
  });

  it('opens the system add-event screen through an intent (no calendar permission)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockStart.mockResolvedValue({});
    await addToCalendar(calendarEvent(detail(), 'Vojvode Mišića 35', t));
    expect(mockStart).toHaveBeenCalledWith('android.intent.action.INSERT', {
      data: 'content://com.android.calendar/events',
      extra: expect.objectContaining({
        beginTime: Date.parse('2026-11-03T07:30:00Z'),
        endTime: Date.parse('2026-11-03T11:30:00Z'),
        eventLocation: 'Vojvode Mišića 35',
      }),
    });
  });

  it('shares when, where and the source', () => {
    const m = shareMessage(detail(), 'Vojvode Mišića 35', '2026-11-03', t);
    expect(m).toContain('utorak, 3. novembar (Danas) 08:30–12:30');
    expect(m).toContain('Vojvode Mišića 35');
    expect(m).toContain('Elektrodistribucija Srbije, https://example.test/eds');
  });
});

describe('OutageDetailView', () => {
  const props = (over: Partial<OutageDetailViewProps> = {}): OutageDetailViewProps => ({
    now: NOW,
    script: 'latn',
    detail: detail(),
    addresses: [],
    loading: false,
    failed: false,
    onRetry: jest.fn(),
    onAddNumber: jest.fn(),
    onClose: jest.fn(),
    onCalendar: jest.fn(),
    onShare: jest.fn(),
    onOpenSource: jest.fn(),
    onReport: jest.fn().mockResolvedValue({ id: 1 }),
    ...over,
  });
  const show = (p: OutageDetailViewProps) =>
    render(
      <ThemeProvider override={buildTheme('dark')}>
        <OutageDetailView {...p} />
      </ThemeProvider>,
    );

  it('shows the date, the window, the duration and a countdown to the start', async () => {
    await show(props());
    expect(screen.getByText('utorak, 3. novembar')).toBeTruthy();
    expect(screen.getByText('Medijana')).toBeTruthy();
    expect(screen.getByText('08:30–12:30')).toBeTruthy();
    expect(screen.getByText('Trajanje: 4 h')).toBeTruthy();
    expect(screen.getByText('Počinje za')).toBeTruthy();
    expect(screen.getByLabelText('2 časa 30 minuta')).toBeTruthy();
    expect(screen.getByText('2 h 30 min')).toBeTruthy(); // hours and minutes, no seconds
    expect(screen.getByText('Uskoro')).toBeTruthy(); // within 24 hours
  });

  it('counts down to the return while the outage runs', async () => {
    await show(props({ detail: detail({ startsAt: '2026-11-03T04:00:00Z' }) }));
    expect(screen.getByText('Povratak za')).toBeTruthy();
    expect(screen.getByText('U toku')).toBeTruthy();
  });

  it('far ahead: whole hours or days instead of a running countdown', async () => {
    await show(
      props({
        detail: detail({
          outageDate: '2026-11-06',
          startsAt: '2026-11-06T07:30:00Z',
          endsAt: '2026-11-06T11:30:00Z',
        }),
      }),
    );
    expect(screen.getByText('3 d')).toBeTruthy();
    expect(screen.queryByText('Povratak za')).toBeNull();
  });

  it('a cancelled outage says so, struck through, with no countdown', async () => {
    await show(props({ detail: detail({ status: 'cancelled' }) }));
    expect(screen.getByText('Isključenje je otkazano.')).toBeTruthy();
    expect(screen.queryByText('Počinje za')).toBeNull();
    expect(screen.getByText('Otkazano')).toBeTruthy();
  });

  it('a changed outage says the time was changed', async () => {
    await show(props({ detail: detail({ status: 'changed', revision: 1 }) }));
    expect(screen.getByText('Vreme isključenja je izmenjeno.')).toBeTruthy();
  });

  it('highlights the range with the number and lists every street', async () => {
    await show(props({ addresses: [mine()] }));
    expect(screen.getByText('Vaš broj 35 je u opsegu neparni 1–41')).toBeTruthy();
    expect(screen.getByLabelText('neparni 1–41, vaš broj')).toBeTruthy();
    expect(screen.getByLabelText('50–60')).toBeTruthy();
    for (const street of ['Studenička', 'Kosmajska', 'неки део'])
      expect(screen.getAllByText(street).length).toBeGreaterThan(0);
  });

  it('offers to add the number when it is the only doubt', async () => {
    const p = props({
      addresses: [
        mine({ houseNumber: null, name: 'Vojvode Mišića', match: 'possible', reason: 'no_number' }),
      ],
    });
    await show(p);
    expect(screen.getByText('Moguće pogođeno — niste uneli broj')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Dodaj broj'));
    expect(p.onAddNumber).toHaveBeenCalledWith(1);
  });

  it('keeps the raw EDS text behind an expander, exactly as published', async () => {
    await show(props());
    expect(
      screen.queryByText('Војводе Мишића (непарни од 1 до 41), делови Студеничке;'),
    ).toBeNull();
    await fireEvent.press(screen.getByLabelText('Prikaži originalni tekst'));
    expect(
      screen.getByText('Војводе Мишића (непарни од 1 до 41), делови Студеничке;'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Sakrij originalni tekst'));
    expect(
      screen.queryByText('Војводе Мишића (непарни од 1 до 41), делови Студеничке;'),
    ).toBeNull();
  });

  it('has the actions: calendar, share, source; no calendar button where it is not available', async () => {
    const p = props();
    const { rerender } = await show(p);
    await fireEvent.press(screen.getByLabelText('Dodaj u kalendar'));
    await fireEvent.press(screen.getByLabelText('Podeli'));
    await fireEvent.press(screen.getByLabelText('Otvori izvor (EDS)'));
    expect(p.onCalendar).toHaveBeenCalled();
    expect(p.onShare).toHaveBeenCalled();
    expect(p.onOpenSource).toHaveBeenCalled();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <OutageDetailView {...p} onCalendar={undefined} />
      </ThemeProvider>,
    );
    expect(screen.queryByLabelText('Dodaj u kalendar')).toBeNull();
  });

  it('sends a report with the typed message, then thanks the person', async () => {
    const p = props();
    await show(p);
    await fireEvent.press(screen.getByLabelText('Prijavi grešku'));
    expect(screen.getByLabelText('Pošalji').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Šta nije tačno?'), 'Ulica nije tačna');
    await fireEvent.press(screen.getByLabelText('Pošalji'));
    await waitFor(() => expect(screen.getByText('Hvala, proverićemo.')).toBeTruthy());
    expect(p.onReport).toHaveBeenCalledWith('Ulica nije tačna');
  });

  it('keeps the report open with a message when sending fails', async () => {
    const p = props({ onReport: jest.fn().mockRejectedValue(new Error('offline')) });
    await show(p);
    await fireEvent.press(screen.getByLabelText('Prijavi grešku'));
    await fireEvent.changeText(screen.getByLabelText('Šta nije tačno?'), 'Greška');
    await fireEvent.press(screen.getByLabelText('Pošalji'));
    await waitFor(() =>
      expect(screen.getByText('Prijava nije poslata. Pokušajte ponovo.')).toBeTruthy(),
    );
  });

  it('shows skeletons while loading, a retry on failure and a note when the outage is gone', async () => {
    const { rerender } = await show(props({ detail: null, loading: true }));
    expect(screen.getAllByLabelText('Učitavanje')).toHaveLength(2);
    const failed = props({ detail: null, failed: true });
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <OutageDetailView {...failed} />
      </ThemeProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Pokušaj ponovo'));
    expect(failed.onRetry).toHaveBeenCalled();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <OutageDetailView {...props({ detail: null })} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Ovo isključenje više nije dostupno.')).toBeTruthy();
  });
  it('has a close button for the sheet, in every state', async () => {
    const p = props();
    const { rerender } = await show(p);
    await fireEvent.press(screen.getByLabelText('Zatvori'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <OutageDetailView {...p} detail={null} loading />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Zatvori')).toBeTruthy();
  });

  describe('the map of the affected streets', () => {
    const streetLine: GeoJSON.Feature = {
      type: 'Feature',
      properties: { name: 'Војводе Мишића' },
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [21.9, 43.31],
            [21.901, 43.32],
          ],
        ],
      },
    };
    const withShapes = detail({ geometry: { type: 'FeatureCollection', features: [streetLine] } });

    it('is part of "Pogođene ulice" when the outage has street geometry', async () => {
      await show(props({ detail: withShapes }));
      expect(screen.getByTestId('outage-map')).toBeTruthy();
      expect(screen.getByText('Pogođene ulice')).toBeTruthy();
    });

    it('is not there without geometry, or when only the saved copy is shown (offline)', async () => {
      const { unmount } = await show(props());
      expect(screen.queryByTestId('outage-map')).toBeNull();
      await unmount();
      await show(props({ detail: withShapes, offline: true }));
      expect(screen.queryByTestId('outage-map')).toBeNull();
      // the street list is still there
      expect(screen.getByText('Pogođene ulice')).toBeTruthy();
    });
  });

  it('shows the "Moguće" badge in the header when an address is only possibly affected', async () => {
    const possible = detail({
      mine: [{ subscriptionId: 1, match: 'possible', reason: 'no_number', point: null }],
    });
    const { unmount } = await show(
      props({
        detail: possible,
        addresses: [mine({ match: 'possible', reason: 'no_number', houseNumber: null })],
      }),
    );
    expect(screen.getByText('Moguće')).toBeTruthy();
    await unmount();
    await show(
      props({
        detail: detail({
          mine: [{ subscriptionId: 1, match: 'affected', reason: null, point: null }],
        }),
      }),
    );
    expect(screen.queryByText('Moguće')).toBeNull();
  });
});

describe('sharing', () => {
  it('uses the system share sheet', async () => {
    const spy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await shareOutage('hello');
    expect(spy).toHaveBeenCalledWith({ message: 'hello' });
  });
});

describe('following a street from the outage detail', () => {
  const d = detail();
  const show = (p: Partial<OutageDetailViewProps>) =>
    render(
      <ThemeProvider override={buildTheme('dark')}>
        <OutageDetailView
          now={NOW}
          script="latn"
          detail={d}
          addresses={[]}
          loading={false}
          failed={false}
          onRetry={jest.fn()}
          onAddNumber={jest.fn()}
          onClose={jest.fn()}
          onShare={jest.fn()}
          onOpenSource={jest.fn()}
          onReport={jest.fn()}
          {...p}
        />
      </ThemeProvider>,
    );

  it('shows "Prati" for a street that can be followed, "Pratite" for one that is, nothing for the rest', async () => {
    const onFollow = jest.fn();
    await show({
      onFollow,
      followState: (seg) =>
        seg.name?.latin === 'Vojvode Mišića'
          ? 'can'
          : seg.name?.latin === 'Studenička'
            ? 'followed'
            : 'none',
    });
    await fireEvent.press(screen.getByLabelText('Prati Vojvode Mišića'));
    expect(onFollow).toHaveBeenCalledWith(d.segments[0]);
    expect(screen.getByText('Pratite')).toBeTruthy();
    expect(screen.queryByLabelText('Prati Kosmajska')).toBeNull();
  });

  it('has no follow buttons when the screen does not offer them', async () => {
    await show({});
    expect(screen.queryByText('Prati')).toBeNull();
    expect(screen.queryByText('Pratite')).toBeNull();
  });
});
