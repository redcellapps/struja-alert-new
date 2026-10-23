import { fireEvent, render, screen } from '@testing-library/react-native';
import type { AddressOutageDto } from '@struja/shared';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { initI18n, i18next } from '../src/i18n';
import { agoLabel, dayCaption, durationShort, spokenDuration } from '../src/home/format';
import { HomeView, type HomeAddress, type HomeViewProps } from '../src/home/HomeView';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Belgrade is UTC+1 in November: 06:00 on Tuesday 3 November 2026.
const NOW = new Date('2026-11-03T05:00:00Z');

beforeAll(async () => {
  await initI18n('sr', 'latn');
});

const t = i18next.t.bind(i18next) as (k: string, o?: Record<string, unknown>) => string;

describe('home formatting', () => {
  it('says how old the data is', () => {
    expect(agoLabel(10_000, t)).toBe('upravo');
    expect(agoLabel(12 * 60_000, t)).toBe('pre 12 min');
    expect(agoLabel(3 * 3_600_000, t)).toBe('pre 3 h');
    expect(agoLabel(72 * 3_600_000, t)).toBe('pre 3 d');
    expect(agoLabel(-5, t)).toBe('upravo');
  });

  it('writes durations short and spoken (Serbian plural forms)', () => {
    expect(durationShort(4 * 3_600_000)).toBe('4 h');
    expect(durationShort(4.5 * 3_600_000)).toBe('4 h 30 min');
    expect(durationShort(45 * 60_000)).toBe('45 min');
    expect(spokenDuration(72 * 60_000, t)).toBe('1 čas 12 minuta');
    expect(spokenDuration(2 * 3_600_000 + 2 * 60_000, t)).toBe('2 časa 2 minuta');
    expect(spokenDuration(5 * 3_600_000, t)).toBe('5 časova');
  });

  it('names a day relative to today', () => {
    expect(dayCaption('2026-11-03', '2026-11-03', t)).toBe('Danas');
    expect(dayCaption('2026-11-04', '2026-11-03', t)).toBe('Sutra');
    expect(dayCaption('2026-11-06', '2026-11-03', t)).toBe('pet 6.11.');
  });
});

let id = 1;
const outage = (
  startsAt: string,
  endsAt: string,
  extra: Partial<AddressOutageDto> = {},
): AddressOutageDto => ({
  id: id++,
  subscriptionId: 1,
  status: 'active',
  startsAt,
  endsAt,
  outageDate: startsAt.slice(0, 10),
  municipality: 'Медијана',
  revision: 0,
  match: 'affected',
  reason: null,
  ...extra,
});

const home = (outages: AddressOutageDto[], over: Partial<HomeAddress> = {}): HomeAddress => ({
  id: 1,
  label: 'Kuća',
  name: 'Vojvode Mišića 34',
  primary: true,
  outages,
  ...over,
});

const props = (over: Partial<HomeViewProps> = {}): HomeViewProps => ({
  now: NOW,
  addresses: [home([])],
  updatedAt: NOW.getTime() - 12 * 60_000,
  loading: false,
  failed: false,
  offline: false,
  notificationsOff: false,
  canAdd: true,
  refreshing: false,
  onRefresh: jest.fn(),
  onAdd: jest.fn(),
  onRetry: jest.fn(),
  onOpenSystemSettings: jest.fn(),
  onOpenAbout: jest.fn(),
  ...over,
});

const show = (p: HomeViewProps) =>
  render(
    <ThemeProvider override={buildTheme('dark')}>
      <HomeView {...p} />
    </ThemeProvider>,
  );

describe('HomeView', () => {
  it('shows an empty start with one action when there is no address', async () => {
    const p = props({ addresses: [] });
    await show(p);
    expect(screen.getByText('Dodajte adresu da biste dobijali obaveštenja.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Dodaj adresu'));
    expect(p.onAdd).toHaveBeenCalled();
  });

  it('shows skeletons while loading and a retry when loading failed', async () => {
    const { rerender } = await show(props({ addresses: [], loading: true }));
    expect(screen.getAllByLabelText('Učitavanje')).toHaveLength(2);
    const p = props({ addresses: [], failed: true });
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <HomeView {...p} />
      </ThemeProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Pokušaj ponovo'));
    expect(p.onRetry).toHaveBeenCalled();
  });

  it('all clear: green hero, no tiles, the freshness and the credit', async () => {
    await show(props());
    expect(screen.getByLabelText(/^Sve u redu\. Vojvode Mišića 34\./)).toBeTruthy();
    expect(screen.queryByText('Trajanje')).toBeNull();
    expect(screen.getByText('Ažurirano pre 12 min')).toBeTruthy();
    expect(screen.getByText('Izvor: Elektrodistribucija Srbije')).toBeTruthy();
  });

  it('within 24 hours: "Uskoro bez struje", a countdown to the start, both tiles', async () => {
    const o = outage('2026-11-03T07:30:00Z', '2026-11-03T11:30:00Z');
    await show(props({ addresses: [home([o])] }));
    expect(screen.getByText('Uskoro bez struje')).toBeTruthy();
    expect(screen.getByText('Počinje za')).toBeTruthy();
    expect(
      screen.getByLabelText('Počinje za 2 časa 30 minuta'), // the spoken countdown
    ).toBeTruthy();
    // tiles: next start and duration
    expect(screen.getByText('Sledeće')).toBeTruthy();
    expect(screen.getByText('4 h')).toBeTruthy();
    expect(screen.getAllByText('08:30–12:30').length).toBeGreaterThan(0);
  });

  it('in progress: "Bez struje", a countdown to the return, and the end time in a tile', async () => {
    const o = outage('2026-11-03T04:00:00Z', '2026-11-03T08:00:00Z');
    await show(props({ addresses: [home([o])] }));
    expect(screen.getByText('Bez struje')).toBeTruthy();
    expect(screen.getByText('Povratak za')).toBeTruthy();
    expect(screen.getByText('Struja se vraća')).toBeTruthy();
    expect(screen.getByText('09:00')).toBeTruthy();
  });

  it('more than 24 hours away: names the day', async () => {
    const tomorrow = outage('2026-11-04T07:30:00Z', '2026-11-04T11:30:00Z');
    const { unmount } = await show(props({ addresses: [home([tomorrow])] }));
    expect(screen.getByText('Sutra bez struje')).toBeTruthy();
    await unmount();
    const friday = outage('2026-11-06T08:00:00Z', '2026-11-06T12:00:00Z');
    await show(props({ addresses: [home([friday])] }));
    expect(screen.getByText('U petak bez struje')).toBeTruthy();
  });

  it('a cancelled outage is shown as cancelled, with no tiles', async () => {
    const o = outage('2026-11-03T07:30:00Z', '2026-11-03T11:30:00Z', { status: 'cancelled' });
    await show(props({ addresses: [home([o])] }));
    expect(screen.getAllByText('Isključenje je otkazano').length).toBeGreaterThan(0);
    expect(screen.queryByText('Trajanje')).toBeNull();
  });

  it('says "possible" when the address may be affected', async () => {
    const o = outage('2026-11-04T07:30:00Z', '2026-11-04T11:30:00Z', {
      match: 'possible',
      reason: 'no_number',
    });
    await show(props({ addresses: [home([o])] }));
    expect(screen.getAllByText(/Moguće pogođeno — niste uneli broj/).length).toBeGreaterThan(0);
  });

  it('the day strip has four days, marks outage days, and switches the address cards to that day', async () => {
    const tomorrow = outage('2026-11-04T07:30:00Z', '2026-11-04T11:30:00Z');
    const friday = outage('2026-11-06T08:00:00Z', '2026-11-06T12:00:00Z');
    await show(props({ addresses: [home([tomorrow, friday])] }));
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByLabelText('sre, 4. ima isključenja')).toBeTruthy();
    expect(screen.getByLabelText('čet, 5. nema isključenja')).toBeTruthy();
    // today: the card shows the next outage, with its day
    expect(screen.getByText('Sutra 08:30–12:30')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('čet, 5. nema isključenja'));
    expect(screen.getByText('Nema isključenja za ovaj dan.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('pet, 6. ima isključenja'));
    expect(screen.getAllByText('09:00–13:00').length).toBeGreaterThan(0);
  });

  it('lists every address, the primary one marked only when there are several', async () => {
    const second = home([], { id: 2, label: null, name: 'Studenička 7', primary: false });
    await show(props({ addresses: [home([]), second] }));
    expect(screen.getByText('Kuća · Glavna adresa')).toBeTruthy();
    expect(screen.getByText('Studenička 7')).toBeTruthy();
  });

  it('offers adding an address until the limit', async () => {
    const p = props();
    const { rerender } = await show(p);
    await fireEvent.press(screen.getByLabelText('Dodaj adresu'));
    expect(p.onAdd).toHaveBeenCalled();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <HomeView {...p} canAdd={false} />
      </ThemeProvider>,
    );
    expect(screen.queryByLabelText('Dodaj adresu')).toBeNull();
  });

  it('shows the offline and the notifications-off notices, and opens the system settings', async () => {
    const p = props({ offline: true, notificationsOff: true });
    await show(p);
    expect(screen.getByText('Prikazujem sačuvane podatke')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Otvori podešavanja'));
    expect(p.onOpenSystemSettings).toHaveBeenCalled();
  });

  it('links the disclaimer to the about screen', async () => {
    const p = props();
    await show(p);
    await fireEvent.press(
      screen.getByLabelText('Nezvanična aplikacija, nije povezana sa EPS ili EDS.'),
    );
    expect(p.onOpenAbout).toHaveBeenCalled();
  });
});
