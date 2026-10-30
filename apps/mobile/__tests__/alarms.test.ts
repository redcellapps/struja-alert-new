import * as Notifications from 'expo-notifications';
import type { AddressOutageDto } from '@struja/shared';
import { i18next, initI18n, setLocale } from '../src/i18n';
import { activeContent, activeNotificationId } from '../src/notifications/active';
import {
  bookFromPush,
  bookFromSync,
  endAlarmId,
  outagePushData,
  planAlarms,
  readBook,
  startAlarmId,
  syncAlarms,
  writeBook,
  type AlarmBook,
} from '../src/notifications/alarms';
import { memoryStorage } from '../src/store/storage';

const t = i18next.t.bind(i18next);
const mocked = jest.mocked(Notifications);
const NOW = new Date('2026-11-03T08:00:00Z'); // 09:00 in Belgrade (winter)

const outage = (over: Partial<AddressOutageDto> = {}): AddressOutageDto => ({
  id: 7,
  subscriptionId: 15,
  status: 'active',
  startsAt: '2026-11-03T09:00:00Z', // 10:00 local
  endsAt: '2026-11-03T14:00:00Z', // 15:00 local
  outageDate: '2026-11-03',
  municipality: 'Палилула',
  revision: 1,
  match: 'affected',
  reason: null,
  ...over,
});

const names = (id: number) => (id === 15 ? 'Trebinjska 34' : id === 16 ? 'Čegarska 2' : undefined);

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
afterEach(() => jest.clearAllMocks());

describe('the alarm book', () => {
  it('is built from a sync with the address as the person sees it, keeping a running outage', () => {
    const previous: AlarmBook = {
      '3': {
        outageId: 3,
        subscriptionId: 15,
        address: 'Trebinjska 34',
        startsAt: '2026-11-03T07:00:00Z',
        endsAt: '2026-11-03T10:00:00Z', // still running at NOW
        status: 'active',
      },
      '2': {
        outageId: 2,
        subscriptionId: 15,
        address: 'Trebinjska 34',
        startsAt: '2026-11-02T07:00:00Z',
        endsAt: '2026-11-02T10:00:00Z', // over: forgotten
        status: 'active',
      },
    };
    const book = bookFromSync(
      [outage(), outage({ id: 8, subscriptionId: 16, status: 'cancelled' })],
      names,
      previous,
      NOW,
    );
    expect(Object.keys(book).sort()).toEqual(['3', '7', '8']);
    expect(book['7']).toEqual({
      outageId: 7,
      subscriptionId: 15,
      address: 'Trebinjska 34',
      startsAt: '2026-11-03T09:00:00Z',
      endsAt: '2026-11-03T14:00:00Z',
      status: 'active',
    });
    expect(book['8']).toMatchObject({ address: 'Čegarska 2', status: 'cancelled' });
  });

  it('is updated from a push: cancelled books no alarm, a change moves it', () => {
    const data = {
      outageId: '7',
      subscriptionId: 15,
      kind: 'changed',
      startsAt: '2026-11-03T10:00:00Z',
      endsAt: '2026-11-03T13:00:00Z',
      address: 'Trebinjska 34',
      link: 'strujaalert://outage/7',
    };
    const push = outagePushData(data);
    expect(push).toEqual({
      outageId: 7,
      subscriptionId: 15,
      kind: 'changed',
      startsAt: '2026-11-03T10:00:00Z',
      endsAt: '2026-11-03T13:00:00Z',
      address: 'Trebinjska 34',
    });
    const changed = bookFromPush(push!, {});
    expect(changed['7']).toMatchObject({ startsAt: '2026-11-03T10:00:00Z', status: 'active' });
    const cancelled = bookFromPush(
      outagePushData({ ...data, kind: 'cancelled', address: '' })!,
      changed,
    );
    expect(cancelled['7']).toMatchObject({ status: 'cancelled', address: 'Trebinjska 34' });
    expect(outagePushData({ outageId: 7 })).toBeNull();
    expect(outagePushData({ ...data, startsAt: 'yesterday' })).toBeNull();
  });

  it('survives a broken store', () => {
    const kv = memoryStorage();
    kv.set('alarm-book', '{not json');
    expect(readBook(kv)).toEqual({});
    writeBook(
      {
        '1': {
          outageId: 1,
          subscriptionId: 1,
          address: 'A',
          startsAt: 's',
          endsAt: 'e',
          status: 'active',
        },
      },
      kv,
    );
    expect(readBook(kv)['1']?.address).toBe('A');
  });
});

describe('planAlarms', () => {
  const entry = (over: Partial<AlarmBook[string]> = {}): AlarmBook[string] => ({
    outageId: 7,
    subscriptionId: 15,
    address: 'Trebinjska 34',
    startsAt: '2026-11-03T09:00:00Z',
    endsAt: '2026-11-03T14:00:00Z',
    status: 'active',
    ...over,
  });

  it('books a start and an end alarm for a coming outage', () => {
    const plan = planAlarms({ '7': entry() }, NOW);
    expect(plan.map((p) => [p.identifier, p.at.toISOString(), p.boundary])).toEqual([
      ['outage-7-active', '2026-11-03T09:00:00.000Z', 'started'],
      ['outage-7-ended', '2026-11-03T14:00:00.000Z', 'ended'],
    ]);
  });

  it('never books anything for a cancelled outage, and nothing for one that is over', () => {
    expect(planAlarms({ '7': entry({ status: 'cancelled' }) }, NOW)).toEqual([]);
    expect(planAlarms({ '7': entry() }, new Date('2026-11-03T14:00:00Z'))).toEqual([]);
  });

  it('books only the end for an outage already running', () => {
    const plan = planAlarms({ '7': entry() }, new Date('2026-11-03T09:30:00Z'));
    expect(plan.map((p) => p.identifier)).toEqual(['outage-7-ended']);
  });
});

describe('the notification content', () => {
  it('says "Bez struje" with the address and the time the power is back, on "hitno"', () => {
    const o = {
      outageId: 7,
      subscriptionId: 15,
      address: 'Trebinjska 34',
      startsAt: '2026-11-03T09:00:00Z',
      endsAt: '2026-11-03T14:00:00Z',
    };
    const started = activeContent(o, 'started', t);
    expect(started).toMatchObject({
      title: 'Bez struje: Trebinjska 34',
      body: 'Povratak u 15:00',
      categoryIdentifier: 'outage',
      sticky: true,
      data: { outageId: 7, subscriptionId: 15, link: 'strujaalert://outage/7', kind: 'started' },
    });
    const ended = activeContent(o, 'ended', t);
    expect(ended).toMatchObject({
      title: 'Struja se vratila',
      body: 'Trebinjska 34',
      sticky: false,
    });
    expect(activeNotificationId(7)).toBe('outage-7-active');
  });

  it('follows the script and the language', async () => {
    const o = {
      outageId: 7,
      subscriptionId: 15,
      address: 'Требињска 34',
      startsAt: '2026-11-03T09:00:00Z',
      endsAt: '2026-11-03T14:00:00Z',
    };
    await setLocale('sr', 'cyrl');
    expect(activeContent(o, 'started', t).title).toBe('Без струје: Требињска 34');
    await setLocale('en', 'latn');
    expect(activeContent(o, 'started', t)).toMatchObject({
      title: 'No power: Требињска 34',
      body: 'Back at 15:00',
    });
    await setLocale('sr', 'latn');
  });
});

describe('syncAlarms', () => {
  const book: AlarmBook = {
    '7': {
      outageId: 7,
      subscriptionId: 15,
      address: 'Trebinjska 34',
      startsAt: '2026-11-03T09:00:00Z',
      endsAt: '2026-11-03T14:00:00Z',
      status: 'active',
    },
  };
  const scheduled = (identifier: string, at: string) =>
    ({
      identifier,
      content: {},
      trigger: { type: 'date', value: new Date(at).getTime() },
    }) as never;

  it('schedules what is missing, on the right channels, at the right moments', async () => {
    await syncAlarms(book, t, NOW);
    expect(mocked.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    const calls = mocked.scheduleNotificationAsync.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.identifier)).toEqual([startAlarmId(7), endAlarmId(7)]);
    expect(calls[0]?.trigger).toEqual({
      type: 'date',
      date: new Date('2026-11-03T09:00:00Z'),
      channelId: 'hitno',
    });
    expect(calls[1]?.trigger).toEqual({
      type: 'date',
      date: new Date('2026-11-03T14:00:00Z'),
      channelId: 'changed',
    });
    expect(calls[0]?.content.title).toBe('Bez struje: Trebinjska 34');
  });

  it('leaves alarms that are already right alone, and reschedules a moved one', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      scheduled('outage-7-active', '2026-11-03T09:00:00Z'),
      scheduled('outage-7-ended', '2026-11-03T13:00:00Z'), // the outage got longer
      scheduled('something-else', '2026-11-03T13:00:00Z'), // not ours
    ]);
    await syncAlarms(book, t, NOW);
    expect(mocked.cancelScheduledNotificationAsync.mock.calls.flat()).toEqual(['outage-7-ended']);
    expect(mocked.scheduleNotificationAsync.mock.calls.map((c) => c[0].identifier)).toEqual([
      'outage-7-ended',
    ]);
  });

  it('cancels every alarm of a cancelled outage and takes down its "Bez struje"', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      scheduled('outage-7-active', '2026-11-03T09:00:00Z'),
      scheduled('outage-7-ended', '2026-11-03T14:00:00Z'),
    ]);
    await syncAlarms({ '7': { ...book['7']!, status: 'cancelled' } }, t, NOW);
    expect(mocked.cancelScheduledNotificationAsync.mock.calls.flat().sort()).toEqual([
      'outage-7-active',
      'outage-7-ended',
    ]);
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mocked.dismissNotificationAsync).toHaveBeenCalledWith('outage-7-active');
  });

  it('cancels the alarms of an outage that left the book', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      scheduled('outage-9-active', '2026-11-03T09:00:00Z'),
      scheduled('outage-9-ended', '2026-11-03T14:00:00Z'),
    ]);
    await syncAlarms({}, t, NOW);
    expect(mocked.cancelScheduledNotificationAsync.mock.calls.flat().sort()).toEqual([
      'outage-9-active',
      'outage-9-ended',
    ]);
  });
});
