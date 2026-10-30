import { readFileSync } from 'node:fs';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import pkg from '../package.json';
import { i18next, initI18n } from '../src/i18n';
import {
  BACKGROUND_TASK,
  defineBackgroundTask,
  handlePayload,
  parsePayload,
  registerBackgroundTask,
  type TaskDeps,
} from '../src/notifications/background';
import { readBook, writeBook, type AlarmBook } from '../src/notifications/alarms';
import { memoryStorage } from '../src/store/storage';

const NOW = new Date('2026-11-03T09:00:05Z');
const boundary = (type: 'outage_started' | 'outage_ended') => ({
  type,
  outageId: 7,
  subscriptionId: 15,
  startsAt: '2026-11-03T09:00:00Z',
  endsAt: '2026-11-03T14:00:00Z',
  possible: false,
});

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
afterEach(() => jest.clearAllMocks());

function setup(book: AlarmBook = {}) {
  const kv = memoryStorage();
  writeBook(book, kv);
  const calls: string[] = [];
  const deps: TaskDeps = {
    kv,
    t: i18next.t.bind(i18next),
    now: () => NOW,
    showActive: async (o) => void calls.push(`active:${o.outageId}:${o.address}`),
    showEnded: async (o) => void calls.push(`ended:${o.outageId}:${o.address}`),
    cancelAlarm: async (id) => void calls.push(`cancel:${id}`),
    syncAlarms: async (b) => void calls.push(`sync:${Object.keys(b).join(',')}`),
    invalidate: () => void calls.push('invalidate'),
  };
  return { kv, deps, calls };
}

describe('parsePayload', () => {
  it('reads the data-only signal from "dataString" (Expo and direct FCM put it there on Android)', () => {
    const parsed = parsePayload({
      notification: null,
      data: { dataString: JSON.stringify(boundary('outage_started')), body: 'x' },
    });
    expect(parsed).toEqual({ kind: 'boundary', push: boundary('outage_started') });
  });

  it('reads it from a parsed "data" object too, and from the "body" key', () => {
    expect(parsePayload({ notification: null, data: boundary('outage_ended') }).kind).toBe(
      'boundary',
    );
    expect(
      parsePayload({ notification: null, data: { body: JSON.stringify(boundary('outage_ended')) } })
        .kind,
    ).toBe('boundary');
  });

  it('tells a notification push about an outage from the rest', () => {
    const data = { outageId: 7, kind: 'new', subscriptionId: 15, startsAt: 's', endsAt: 'e' };
    expect(parsePayload({ notification: {}, data: { dataString: JSON.stringify(data) } })).toEqual({
      kind: 'outage',
      data,
    });
    expect(parsePayload({ actionIdentifier: 'detalji', notification: {} }).kind).toBe('other');
    expect(parsePayload({ notification: null, data: { dataString: '{broken' } }).kind).toBe(
      'other',
    );
    expect(parsePayload(null).kind).toBe('other');
    expect(parsePayload({ data: { hello: 'world' } }).kind).toBe('other');
  });
});

describe('handlePayload', () => {
  const known: AlarmBook = {
    '7': {
      outageId: 7,
      subscriptionId: 15,
      address: 'Trebinjska 34',
      startsAt: '2026-11-03T09:00:00Z',
      endsAt: '2026-11-03T14:00:00Z',
      status: 'active',
    },
  };

  it('"outage started": cancels the start alarm and shows "Bez struje" with the known address', async () => {
    const { deps, calls } = setup(known);
    await handlePayload({ kind: 'boundary', push: boundary('outage_started') }, deps);
    expect(calls).toEqual(['cancel:outage-7-active', 'active:7:Trebinjska 34', 'invalidate']);
  });

  it('"outage ended": cancels the end alarm, shows "Struja se vratila", forgets the outage', async () => {
    const { deps, calls, kv } = setup(known);
    await handlePayload({ kind: 'boundary', push: boundary('outage_ended') }, deps);
    expect(calls).toEqual(['cancel:outage-7-ended', 'ended:7:Trebinjska 34', 'invalidate']);
    expect(readBook(kv)).toEqual({});
  });

  it('shows the signal even for an outage the phone never heard of (no address then)', async () => {
    const { deps, calls } = setup();
    await handlePayload({ kind: 'boundary', push: boundary('outage_started') }, deps);
    expect(calls[1]).toBe('active:7:');
  });

  it('a notification push books the alarms from its data alone', async () => {
    const { deps, calls, kv } = setup();
    await handlePayload(
      {
        kind: 'outage',
        data: {
          outageId: 8,
          subscriptionId: 15,
          kind: 'new',
          startsAt: '2026-11-04T07:00:00Z',
          endsAt: '2026-11-04T12:00:00Z',
          address: 'Trebinjska 34',
          link: 'strujaalert://outage/8',
        },
      },
      deps,
    );
    expect(calls).toEqual(['sync:8', 'invalidate']);
    expect(readBook(kv)['8']).toMatchObject({ address: 'Trebinjska 34', status: 'active' });
  });

  it('a "cancelled" push marks the outage so no alarm survives', async () => {
    const { deps, kv } = setup(known);
    await handlePayload(
      {
        kind: 'outage',
        data: {
          outageId: '7',
          subscriptionId: '15',
          kind: 'cancelled',
          startsAt: '2026-11-03T09:00:00Z',
          endsAt: '2026-11-03T14:00:00Z',
        },
      },
      deps,
    );
    expect(readBook(kv)['7']).toMatchObject({ status: 'cancelled', address: 'Trebinjska 34' });
  });

  it('ignores a push it cannot read, leaving the book as it was', async () => {
    const { deps, calls, kv } = setup(known);
    await handlePayload({ kind: 'outage', data: { outageId: 7 } }, deps);
    await handlePayload({ kind: 'other' }, deps);
    expect(calls).toEqual([]);
    expect(readBook(kv)).toEqual(known);
  });
});

describe('the task', () => {
  it('is defined once at module scope and registered with the system', async () => {
    defineBackgroundTask();
    defineBackgroundTask();
    expect(jest.mocked(TaskManager.defineTask)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(TaskManager.defineTask).mock.calls[0]?.[0]).toBe(BACKGROUND_TASK);
    await registerBackgroundTask();
    expect(jest.mocked(Notifications.registerTaskAsync)).toHaveBeenCalledWith(BACKGROUND_TASK);
  });

  it('is defined by the entry file before the router', () => {
    const entry = readFileSync(`${__dirname}/../index.ts`, 'utf8');
    expect(entry.indexOf('defineBackgroundTask()')).toBeLessThan(
      entry.indexOf("import 'expo-router/entry'"),
    );
    expect((pkg as { main: string }).main).toBe('index.ts');
  });
});
