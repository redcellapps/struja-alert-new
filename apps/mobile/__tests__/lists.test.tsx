import { fireEvent, render, screen } from '@testing-library/react-native';
import type { AddressOutageDto } from '@struja/shared';
import { gazetteer } from '../mock-server/fixtures';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { buildIndex, findStreet, search } from '../src/gazetteer/search';
import { groupByMonth, monthTitle, ofSavedAddresses, yearSummary } from '../src/history/group';
import { HistoryView, type HistoryViewProps } from '../src/history/HistoryView';
import { i18next, initI18n } from '../src/i18n';
import {
  groupByDay,
  inScript,
  matchesQuery,
  streetsSummary,
  type CityOutage,
} from '../src/upcoming/group';
import { UpcomingView, type UpcomingViewProps } from '../src/upcoming/UpcomingView';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
const t = i18next.t.bind(i18next) as (k: string, o?: Record<string, unknown>) => string;

// 06:00 on Friday 23 October 2026 in Belgrade (UTC+2 until the clocks change on 25 October).
const NOW = new Date('2026-10-23T04:00:00Z');

let id = 1;
const city = (over: Partial<CityOutage> = {}): CityOutage => ({
  id: id++,
  municipality: 'Медијана',
  startsAt: '2026-10-23T15:30:00Z',
  endsAt: '2026-10-23T19:30:00Z',
  outageDate: '2026-10-23',
  status: 'active',
  streets: ['Војводе Мишића', 'Студеничка'],
  ...over,
});

describe('upcoming logic', () => {
  it('matches the typed words against streets and municipality, in any script', () => {
    const o = city({ streets: ['Булевар Немањића', 'Чегарска'], municipality: 'Пантелеј' });
    for (const q of [
      'cegar',
      'ЧЕГАР',
      'чегарска',
      'bulevar nem',
      'nemanjica bulevar',
      'pantel',
      '',
    ]) {
      expect(matchesQuery(o, q)).toBe(true);
    }
    expect(matchesQuery(o, 'studen')).toBe(false);
    expect(matchesQuery(o, 'cegar xyz')).toBe(false);
  });

  it('groups by day in order, naming today and tomorrow', () => {
    const list = [
      city({ outageDate: '2026-10-25', startsAt: '2026-10-25T08:00:00Z' }),
      city({ outageDate: '2026-10-23', startsAt: '2026-10-23T15:30:00Z' }),
      city({ outageDate: '2026-10-24', startsAt: '2026-10-24T09:00:00Z' }),
      city({ outageDate: '2026-10-23', startsAt: '2026-10-23T10:00:00Z' }),
    ];
    const groups = groupByDay(list, '2026-10-23', t);
    expect(groups.map((g) => g.title)).toEqual([
      'Danas · petak 23.',
      'Sutra · subota 24.',
      'nedelja 25.',
    ]);
    expect(groups[0]?.outages.map((o) => o.startsAt)).toEqual([
      '2026-10-23T10:00:00Z',
      '2026-10-23T15:30:00Z',
    ]);
  });

  it('shows the first streets and counts the rest, in the chosen script', () => {
    const streets = ['Војводе Мишића', 'Студеничка', 'Космајска', 'Чегарска', 'Бубањ'];
    expect(streetsSummary(streets, 'latn')).toEqual({
      shown: ['Vojvode Mišića', 'Studenička', 'Kosmajska'],
      more: 2,
    });
    expect(streetsSummary(streets, 'cyrl').shown[0]).toBe('Војводе Мишића');
    expect(streetsSummary(['Бубањ'], 'latn')).toEqual({ shown: ['Bubanj'], more: 0 });
    expect(inScript('Нишка Бања', 'latn')).toBe('Niška Banja');
  });
});

describe('findStreet', () => {
  const index = buildIndex(gazetteer);
  it('finds the street that goes by the name, whatever the script', () => {
    expect(findStreet(index, 'Vojvode Mišića')?.id).toBe(1);
    expect(findStreet(index, 'Војводе Мишића')?.id).toBe(1);
    expect(findStreet(index, 'studenicka')?.id).toBe(2);
  });
  it('finds nothing for a settlement, a partial name or an unknown street', () => {
    expect(findStreet(index, 'Bubanj')).toBeUndefined();
    expect(findStreet(index, 'Vojvode')).toBeUndefined();
    expect(findStreet(index, 'Nema takve')).toBeUndefined();
    expect(search(index, 'bubanj')).toHaveLength(1);
  });
});

const view = (p: UpcomingViewProps) =>
  render(
    <ThemeProvider override={buildTheme('dark')}>
      <UpcomingView {...p} />
    </ThemeProvider>,
  );
const upcoming = (over: Partial<UpcomingViewProps> = {}): UpcomingViewProps => ({
  now: NOW,
  script: 'latn',
  outages: [],
  mineIds: new Set(),
  query: '',
  onQuery: jest.fn(),
  suggestions: [],
  canFollow: true,
  onFollow: jest.fn(),
  onOpen: jest.fn(),
  updatedAt: NOW.getTime() - 5 * 60_000,
  loading: false,
  failed: false,
  offline: false,
  refreshing: false,
  onRefresh: jest.fn(),
  onRetry: jest.fn(),
  ...over,
});

describe('UpcomingView', () => {
  it('lists the outages by day with the time, place and streets, and opens one', async () => {
    const o = city({ id: 41, streets: ['Булевар Немањића', 'Космајска', 'Чегарска', 'Бубањ'] });
    const p = upcoming({ outages: [o] });
    await view(p);
    expect(screen.getByText('Danas · petak 23.')).toBeTruthy();
    expect(screen.getByText('17:30–21:30')).toBeTruthy();
    expect(screen.getByText('Medijana')).toBeTruthy();
    expect(screen.getByText('Bulevar Nemanjića, Kosmajska, Čegarska · i još 1')).toBeTruthy();
    expect(screen.getByText('Ažurirano pre 5 min')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^petak, 23\. oktobar, 17:30–21:30/));
    expect(p.onOpen).toHaveBeenCalledWith(41);
  });

  it('tags the outage of the person’s own address, a cancelled and a changed one', async () => {
    const list = [
      city({ id: 1 }),
      city({ id: 2, status: 'cancelled' }),
      city({ id: 3, status: 'changed' }),
    ];
    await view(upcoming({ outages: list, mineIds: new Set([1]) }));
    expect(screen.getByText('Vaša adresa')).toBeTruthy();
    expect(screen.getAllByText('Otkazano')).toHaveLength(1);
    expect(screen.getByText('Izmenjeno')).toBeTruthy();
  });

  it('filters by the typed street and says so when nothing matches', async () => {
    const list = [city({ streets: ['Студеничка'] }), city({ streets: ['Чегарска'] })];
    const { rerender } = await view(upcoming({ outages: list, query: 'cegar' }));
    expect(screen.getByText('Čegarska')).toBeTruthy();
    expect(screen.queryByText('Studenička')).toBeNull();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <UpcomingView {...upcoming({ outages: list, query: 'zzz' })} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Nema rezultata za „zzz“.')).toBeTruthy();
  });

  it('offers to follow the streets that match, with the right words when it cannot', async () => {
    const index = buildIndex(gazetteer);
    const places = [
      { place: findStreet(index, 'Vojvode Mišića')!, followed: false },
      { place: findStreet(index, 'Studenička')!, followed: true },
    ];
    const p = upcoming({ query: 'vo', suggestions: places });
    const { rerender } = await view(p);
    expect(screen.getByText('Pratite ulicu')).toBeTruthy();
    expect(screen.getByText('Pratite')).toBeTruthy(); // Studenička is followed already
    await fireEvent.press(screen.getByLabelText('Prati Vojvode Mišića'));
    expect(p.onFollow).toHaveBeenCalledWith(places[0]?.place);
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <UpcomingView {...p} canFollow={false} />
      </ThemeProvider>,
    );
    expect(screen.queryByLabelText('Prati Vojvode Mišića')).toBeNull();
    expect(screen.getByText('Već pratite najviše 3 adrese.')).toBeTruthy();
  });

  it('shows skeletons, an error with retry, an empty day and the offline notice', async () => {
    const { rerender } = await view(upcoming({ loading: true }));
    expect(screen.getAllByLabelText('Učitavanje')).toHaveLength(2);
    const failed = upcoming({ failed: true });
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <UpcomingView {...failed} />
      </ThemeProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Pokušaj ponovo'));
    expect(failed.onRetry).toHaveBeenCalled();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <UpcomingView {...upcoming({ offline: true, outages: [city()] })} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Prikazujem sačuvane podatke')).toBeTruthy();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <UpcomingView {...upcoming()} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Nema najavljenih isključenja')).toBeTruthy();
  });
});

let hid = 100;
const past = (
  start: string,
  hours: number,
  over: Partial<AddressOutageDto> = {},
): AddressOutageDto => ({
  id: hid++,
  subscriptionId: 1,
  status: 'active',
  startsAt: start,
  endsAt: new Date(Date.parse(start) + hours * 3_600_000).toISOString(),
  outageDate: start.slice(0, 10),
  municipality: 'Медијана',
  revision: 0,
  match: 'affected',
  reason: null,
  ...over,
});

describe('history logic', () => {
  it('keeps only the outages of the saved addresses, without touching the data', () => {
    const all = [
      past('2026-10-21T14:00:00Z', 3, { subscriptionId: 1 }),
      past('2026-10-14T14:00:00Z', 3, { subscriptionId: 2 }),
      past('2026-10-07T14:00:00Z', 3, { subscriptionId: 9 }),
    ];
    expect(ofSavedAddresses(all, [1, 2]).map((o) => o.subscriptionId)).toEqual([1, 2]);
    expect(ofSavedAddresses(all, [])).toEqual([]);
    expect(all).toHaveLength(3); // the full list is still there: it comes back with the address
    expect(ofSavedAddresses(all, [1, 2, 9])).toHaveLength(3);
  });

  const list = [
    past('2026-09-12T14:00:00Z', 5),
    past('2026-10-21T14:00:00Z', 3),
    past('2026-10-04T14:00:00Z', 3, { status: 'cancelled' }),
    past('2025-12-30T14:00:00Z', 6),
    past('2026-10-14T14:00:00Z', 4),
  ];

  it('groups by month, newest first, with the month named', () => {
    const groups = groupByMonth(list, t);
    expect(groups.map((g) => g.title)).toEqual(['Oktobar 2026', 'Septembar 2026', 'Decembar 2025']);
    expect(groups[0]?.outages.map((o) => o.outageDate)).toEqual([
      '2026-10-21',
      '2026-10-14',
      '2026-10-04',
    ]);
    expect(monthTitle('2026-06-15', t)).toBe('Jun 2026');
  });

  it('sums the year: only outages that happened, in whole hours', () => {
    expect(yearSummary(list, '2026')).toEqual({ count: 3, hours: 12 });
    expect(yearSummary(list, '2025')).toEqual({ count: 1, hours: 6 });
    expect(yearSummary([], '2026')).toEqual({ count: 0, hours: 0 });
  });
});

const history = (over: Partial<HistoryViewProps> = {}): HistoryViewProps => ({
  now: NOW,
  outages: [],
  addresses: [{ id: 1, label: 'Kuća', name: 'Vojvode Mišića 34' }],
  updatedAt: NOW.getTime() - 60_000,
  loading: false,
  failed: false,
  offline: false,
  refreshing: false,
  onRefresh: jest.fn(),
  onRetry: jest.fn(),
  onOpen: jest.fn(),
  ...over,
});
const showHistory = (p: HistoryViewProps) =>
  render(
    <ThemeProvider override={buildTheme('dark')}>
      <HistoryView {...p} />
    </ThemeProvider>,
  );

describe('HistoryView', () => {
  const list = [
    past('2026-10-21T14:00:00Z', 3, { id: 7 }),
    past('2026-10-04T14:00:00Z', 3, { status: 'cancelled' }),
    past('2026-09-12T14:00:00Z', 5, { subscriptionId: 99 }),
  ];

  it('shows the year in two tiles, the months, and opens an outage with its address', async () => {
    const p = history({ outages: list });
    await showHistory(p);
    expect(screen.getByText('Ove godine')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy(); // the outage that happened this year at a saved address
    expect(screen.getByText('3 h')).toBeTruthy();
    expect(screen.getByText('Oktobar 2026')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^sreda, 21\. oktobar, 16:00–19:00\. Kuća/));
    expect(p.onOpen).toHaveBeenCalledWith(7, 1);
  });

  it('marks a cancelled outage', async () => {
    await showHistory(history({ outages: list }));
    expect(screen.getAllByText('Otkazano').length).toBeGreaterThan(0);
  });

  it('hides the outages of an address that was deleted, and does not count them in the year', async () => {
    await showHistory(history({ outages: list }));
    // the September outage belongs to address 99, which is not saved any more
    expect(screen.queryByText('Septembar 2026')).toBeNull();
    expect(screen.queryByText('Obrisana adresa')).toBeNull();
    expect(screen.getByText('Oktobar 2026')).toBeTruthy();
  });

  it('is empty before the first outage, loading, failed and offline', async () => {
    const { rerender } = await showHistory(history());
    expect(screen.getByText('Još nema isključenja za vaše adrese.')).toBeTruthy();
    const states: Partial<HistoryViewProps>[] = [
      { loading: true },
      { failed: true },
      { offline: true, outages: list },
    ];
    for (const s of states) {
      await rerender(
        <ThemeProvider override={buildTheme('dark')}>
          <HistoryView {...history(s)} />
        </ThemeProvider>,
      );
    }
    expect(screen.getByText('Prikazujem sačuvane podatke')).toBeTruthy();
    expect(screen.getByText('Oktobar 2026')).toBeTruthy();
  });
});
