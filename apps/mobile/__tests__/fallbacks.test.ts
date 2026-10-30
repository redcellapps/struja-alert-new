import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import type { AddressOutageDto, SubscriptionDto } from '@struja/shared';
import { i18next, initI18n } from '../src/i18n';
import { readBook, syncAlarms, writeBook, type AlarmBook } from '../src/notifications/alarms';
import { handlePayload, parsePayload, type TaskDeps } from '../src/notifications/background';
import { exactAlarmsState, requestExactAlarms } from '../src/notifications/exactAlarms';
import {
  registerRefreshTask,
  REFRESH_TASK,
  runRefresh,
  type RefreshDeps,
} from '../src/notifications/refresh';
import { isHonorOrHuawei, openAppLaunchSettings } from '../src/notifications/vendor';
import { memoryStorage } from '../src/store/storage';

const mocked = jest.mocked(Notifications);
const t = i18next.t.bind(i18next);
const NOW = new Date('2026-11-03T08:00:00Z'); // 09:00 Belgrade

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
afterEach(() => jest.clearAllMocks());

const booked: AlarmBook = {
  '7': {
    outageId: 7,
    subscriptionId: 15,
    address: 'Trebinjska 34',
    startsAt: '2026-11-03T12:00:00Z', // 13:00 local
    endsAt: '2026-11-03T17:00:00Z',
    status: 'active',
  },
};
const scheduled = (identifier: string, at: string) =>
  ({ identifier, content: {}, trigger: { type: 'date', value: new Date(at).getTime() } }) as never;

describe('the companion push of a change (the app killed)', () => {
  it('moves the alarm: 13:00 is cancelled, 15:00 is booked, nothing fires at 13:00', async () => {
    const kv = memoryStorage();
    writeBook(booked, kv);
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      scheduled('outage-7-active', '2026-11-03T12:00:00Z'),
      scheduled('outage-7-ended', '2026-11-03T17:00:00Z'),
    ]);
    const deps: TaskDeps = {
      kv,
      t,
      now: () => NOW,
      showActive: jest.fn(),
      showEnded: jest.fn(),
      cancelAlarm: jest.fn(),
      syncAlarms, // the real one, against the mocked notification module
    };
    // exactly what the server sends with every "Izmena": the notification's data, data-only
    const payload = parsePayload({
      notification: null,
      data: {
        dataString: JSON.stringify({
          outageId: 7,
          kind: 'changed',
          subscriptionId: 15,
          startsAt: '2026-11-03T14:00:00Z', // 15:00 local
          endsAt: '2026-11-03T19:00:00Z',
          address: 'Trebinjska 34',
          link: 'strujaalert://outage/7',
        }),
      },
    });
    expect(payload.kind).toBe('outage');
    await handlePayload(payload, deps);

    expect(readBook(kv)['7']).toMatchObject({ startsAt: '2026-11-03T14:00:00Z', status: 'active' });
    expect(mocked.cancelScheduledNotificationAsync.mock.calls.flat().sort()).toEqual([
      'outage-7-active',
      'outage-7-ended',
    ]);
    const set = mocked.scheduleNotificationAsync.mock.calls.map((c) => c[0]);
    expect(
      set.map((c) => [c.identifier, (c.trigger as { date: Date }).date.toISOString()]),
    ).toEqual([
      ['outage-7-active', '2026-11-03T14:00:00.000Z'],
      ['outage-7-ended', '2026-11-03T19:00:00.000Z'],
    ]);
  });

  it('cancels the alarm and takes "Bez struje" down on "Otkazano"', async () => {
    const kv = memoryStorage();
    writeBook(booked, kv);
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      scheduled('outage-7-active', '2026-11-03T12:00:00Z'),
    ]);
    await handlePayload(
      parsePayload({
        notification: null,
        data: {
          dataString: JSON.stringify({
            outageId: 7,
            kind: 'cancelled',
            subscriptionId: 15,
            startsAt: '2026-11-03T12:00:00Z',
            endsAt: '2026-11-03T17:00:00Z',
          }),
        },
      }),
      {
        kv,
        t,
        now: () => NOW,
        showActive: jest.fn(),
        showEnded: jest.fn(),
        cancelAlarm: jest.fn(),
        syncAlarms,
      },
    );
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('outage-7-active');
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mocked.dismissNotificationAsync).toHaveBeenCalledWith('outage-7-active');
  });
});

describe('the periodic refresh (the second line)', () => {
  const sub = {
    id: 15,
    name: { latin: 'Trebinjska', cyrillic: 'Требињска' },
    houseNumber: 34,
    houseSuffix: null,
  } as unknown as SubscriptionDto;
  const outage = (over: Partial<AddressOutageDto>): AddressOutageDto =>
    ({
      id: 7,
      subscriptionId: 15,
      status: 'active',
      startsAt: '2026-11-03T14:00:00Z',
      endsAt: '2026-11-03T19:00:00Z',
      outageDate: '2026-11-03',
      municipality: 'Палилула',
      revision: 2,
      match: 'affected',
      reason: null,
      ...over,
    }) as AddressOutageDto;
  const deps = (over: Partial<RefreshDeps> = {}): RefreshDeps & { synced: AlarmBook[] } => {
    const synced: AlarmBook[] = [];
    return {
      kv: memoryStorage(),
      t,
      now: () => NOW,
      hasAddresses: () => true,
      script: () => 'latn',
      fetchSubscriptions: async () => [sub],
      fetchOutages: async () => [outage({})],
      syncAlarms: async (book) => void synced.push(book),
      synced,
      ...over,
    };
  };

  it('rebuilds the book from the server and syncs the alarms', async () => {
    const d = deps();
    writeBook(booked, d.kv);
    expect(await runRefresh(d)).toBe('synced');
    expect(readBook(d.kv)['7']).toMatchObject({
      startsAt: '2026-11-03T14:00:00Z',
      address: 'Trebinjska 34',
    });
    expect(d.synced).toHaveLength(1);
  });

  it('does nothing without addresses, and reports a failed fetch without touching the book', async () => {
    const none = deps({ hasAddresses: () => false });
    expect(await runRefresh(none)).toBe('no-data');
    const broken = deps({ fetchOutages: async () => Promise.reject(new Error('offline')) });
    writeBook(booked, broken.kv);
    expect(await runRefresh(broken)).toBe('failed');
    expect(readBook(broken.kv)).toEqual(booked);
    expect(broken.synced).toHaveLength(0);
  });

  it('registers with the system every 15 minutes', async () => {
    await registerRefreshTask();
    expect(jest.mocked(BackgroundTask.registerTaskAsync)).toHaveBeenCalledWith(REFRESH_TASK, {
      minimumInterval: 15,
    });
  });
});

describe('exact alarms and the HONOR / Huawei card', () => {
  it('reads the exact-alarm state and asks through the system screen (Android 12+)', async () => {
    const android15 = { os: 'android', version: 35 };
    expect(await exactAlarmsState(android15)).toBe('denied');
    expect(await requestExactAlarms(android15)).toBe('allowed');
    expect(mocked.requestExactAlarmPermissionsAsync).toHaveBeenCalled();
  });

  it('is "unknown" off Android, and allowed before Android 12 without asking', async () => {
    expect(await exactAlarmsState({ os: 'ios', version: 26 })).toBe('unknown');
    expect(await exactAlarmsState({ os: 'android', version: 30 })).toBe('allowed');
    expect(await requestExactAlarms({ os: 'android', version: 30 })).toBe('allowed');
    expect(mocked.getExactAlarmPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.requestExactAlarmPermissionsAsync).not.toHaveBeenCalled();
  });

  it('knows the makers the card is for', () => {
    expect(isHonorOrHuawei('honor')).toBe(true);
    expect(isHonorOrHuawei('HUAWEI'.toLowerCase())).toBe(true);
    expect(isHonorOrHuawei('samsung')).toBe(false);
    expect(isHonorOrHuawei('')).toBe(false);
  });

  it('opens the "App launch" list when the phone has one, else the app’s settings page', async () => {
    const tried: string[] = [];
    const honor = await openAppLaunchSettings(
      async (_a, p) => {
        tried.push(p.packageName);
        if (p.packageName !== 'com.hihonor.systemmanager') throw new Error('no activity');
      },
      async () => undefined,
    );
    expect(honor).toBe('app-launch');
    expect(tried).toEqual(['com.hihonor.systemmanager']);
    let fellBack = false;
    const other = await openAppLaunchSettings(
      async () => {
        throw new Error('no activity');
      },
      async () => {
        fellBack = true;
      },
    );
    expect(other).toBe('app-settings');
    expect(fellBack).toBe(true);
  });
});
