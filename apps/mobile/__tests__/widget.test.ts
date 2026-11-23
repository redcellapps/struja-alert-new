import { i18next, initI18n, setLocale } from '../src/i18n';
import type { AlarmBook } from '../src/notifications/alarms';
import { writeBook } from '../src/notifications/alarms';
import { forgetWidget, refreshWidget } from '../src/widget/refresh';
import {
  buildWidgetSnapshot,
  readWidgetAddresses,
  writeWidgetAddresses,
} from '../src/widget/snapshot';
import { memoryStorage } from '../src/store/storage';
import { clearWidgetSnapshot } from '../modules/struja-widget';

const t = i18next.t.bind(i18next);
const NOW = new Date('2026-11-03T08:00:00Z'); // 09:00 Belgrade

const book: AlarmBook = {
  '7': {
    outageId: 7,
    subscriptionId: 15,
    address: 'Trebinjska 34',
    startsAt: '2026-11-03T12:00:00Z',
    endsAt: '2026-11-03T17:00:00Z',
    status: 'active',
  },
  '8': {
    outageId: 8,
    subscriptionId: 15,
    address: 'Trebinjska 34',
    startsAt: '2026-11-04T07:00:00Z',
    endsAt: '2026-11-04T10:00:00Z',
    status: 'cancelled', // never shown
  },
  '9': {
    outageId: 9,
    subscriptionId: 16,
    address: 'Čegarska 2',
    startsAt: '2026-11-02T07:00:00Z',
    endsAt: '2026-11-02T10:00:00Z', // over: not shown
    status: 'active',
  },
  '10': {
    outageId: 10,
    subscriptionId: 15,
    address: 'Trebinjska 34',
    startsAt: '2026-11-03T06:00:00Z',
    endsAt: '2026-11-03T10:00:00Z', // running now: shown
    status: 'changed',
  },
};
const addresses = [
  { id: 16, name: 'Čegarska 2', primary: false },
  { id: 15, name: 'Trebinjska 34', primary: true },
];

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
afterEach(() => jest.clearAllMocks());

describe('the widget snapshot', () => {
  it('carries the addresses with their coming outages, sorted, without cancelled or past ones', () => {
    const s = buildWidgetSnapshot(addresses, book, t, NOW);
    expect(s.v).toBe(1);
    expect(s.addresses.map((a) => [a.id, a.primary, a.outages.map((o) => o.id)])).toEqual([
      [16, false, []],
      [15, true, [10, 7]],
    ]);
    expect(s.addresses[1]?.outages[0]).toEqual({
      id: 10,
      startsAt: Date.parse('2026-11-03T06:00:00Z'),
      endsAt: Date.parse('2026-11-03T10:00:00Z'),
      possible: false,
    });
  });

  it('carries every label the native side needs, in the chosen language and script', async () => {
    const sr = buildWidgetSnapshot(addresses, book, t, NOW).labels;
    expect(sr).toMatchObject({
      clear: 'Sve u redu',
      today: 'Danas bez struje',
      tomorrow: 'Sutra bez struje',
      active: 'Bez struje',
      backAt: 'povratak u {time}',
      possible: 'Moguće pogođeno',
      noAddress: 'Dodajte adresu',
      appName: 'Struja Alert',
    });
    expect(sr['weekdays']).toEqual(['pon', 'uto', 'sre', 'čet', 'pet', 'sub', 'ned']);
    await setLocale('sr', 'cyrl');
    expect(buildWidgetSnapshot(addresses, book, t, NOW).labels['today']).toBe('Данас без струје');
    await setLocale('en', 'latn');
    expect(buildWidgetSnapshot(addresses, book, t, NOW).labels['clear']).toBe('All clear');
    await setLocale('sr', 'latn');
  });

  it('keeps the address list for the headless paths', () => {
    const kv = memoryStorage();
    expect(readWidgetAddresses(kv)).toEqual([]);
    writeWidgetAddresses(addresses, kv);
    expect(readWidgetAddresses(kv)).toEqual(addresses);
    kv.set('widget-addresses', '{broken');
    expect(readWidgetAddresses(kv)).toEqual([]);
  });
});

describe('refreshing the widget', () => {
  it('sends the snapshot built from the stored addresses and the alarm book', async () => {
    const kv = memoryStorage();
    writeWidgetAddresses(addresses, kv);
    writeBook(book, kv);
    const sent: string[] = [];
    const send = async (json: string) => {
      sent.push(json);
      return true;
    };
    expect(await refreshWidget(t, NOW, kv, send)).toBe(true);
    const s = JSON.parse(sent[0]!) as ReturnType<typeof buildWidgetSnapshot>;
    expect(s.addresses.find((a) => a.id === 15)?.outages.map((o) => o.id)).toEqual([10, 7]);
    expect(s.updatedAt).toBe(NOW.getTime());
  });

  it('never throws: a failing native side reports false', async () => {
    expect(
      await refreshWidget(t, NOW, memoryStorage(), async () => Promise.reject(new Error('no'))),
    ).toBe(false);
  });

  it('forgets everything after "delete all my data"', async () => {
    const kv = memoryStorage();
    writeWidgetAddresses(addresses, kv);
    await forgetWidget(kv);
    expect(readWidgetAddresses(kv)).toEqual([]);
    expect(jest.mocked(clearWidgetSnapshot)).toHaveBeenCalled();
  });
});
