import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import type { AddressOutageDto, SubscriptionDto } from '@struja/shared';
import type { T } from '../home/format';
import { i18next, initI18n } from '../i18n';
import { useAddresses } from '../store/addresses';
import { useSettings } from '../store/settings';
import { storage, type KeyValueStorage } from '../store/storage';
import { bookFromSync, readBook, syncAlarms, writeBook, type AlarmBook } from './alarms';

// The second line behind the local alarms (decided 30 Oct): every 15 minutes or so, when the
// system allows, the app fetches its addresses' outages and makes the alarms match, so a changed
// or cancelled outage is corrected even if the companion push never arrived. Android runs it
// through WorkManager at its own pace (not before the interval, often later, not in Doze).

export const REFRESH_TASK = 'struja-alert-refresh';
export const REFRESH_INTERVAL_MINUTES = 15;

export interface RefreshDeps {
  kv: KeyValueStorage;
  t: T;
  now: () => Date;
  hasAddresses: () => boolean;
  script: () => 'latn' | 'cyrl';
  fetchSubscriptions: () => Promise<SubscriptionDto[]>;
  fetchOutages: () => Promise<AddressOutageDto[]>;
  syncAlarms: (book: AlarmBook, t: T, now: Date) => Promise<void>;
}

/** One refresh: the book from the server's answer, the alarms from the book. Pure apart from deps. */
export async function runRefresh(deps: RefreshDeps): Promise<'no-data' | 'synced' | 'failed'> {
  if (!deps.hasAddresses()) return 'no-data';
  let subs: SubscriptionDto[];
  let outages: AddressOutageDto[];
  try {
    [subs, outages] = await Promise.all([deps.fetchSubscriptions(), deps.fetchOutages()]);
  } catch {
    return 'failed';
  }
  const script = deps.script();
  const names = new Map(
    subs.map((s) => {
      const base = script === 'cyrl' ? s.name.cyrillic : s.name.latin;
      const number = s.houseNumber ? ` ${s.houseNumber}${s.houseSuffix ?? ''}` : '';
      return [s.id, `${base}${number}`];
    }),
  );
  const book = bookFromSync(outages, (id) => names.get(id), readBook(deps.kv));
  writeBook(book, deps.kv);
  await deps.syncAlarms(book, deps.t, deps.now());
  return 'synced';
}

/** The real dependencies: the API client, MMKV, the saved settings and the notification module. */
export async function liveRefreshDeps(): Promise<RefreshDeps> {
  const { api } = await import('../api/runtime');
  const { language, script } = useSettings.getState();
  if (!i18next.isInitialized) await initI18n(language, script);
  return {
    kv: storage(),
    t: i18next.t.bind(i18next),
    now: () => new Date(),
    hasAddresses: () => useAddresses.getState().items.length > 0,
    script: () => useSettings.getState().script,
    fetchSubscriptions: async () => (await api.subscriptions()).subscriptions,
    fetchOutages: async () => (await api.myOutages('upcoming')).outages,
    syncAlarms,
  };
}

/** Defines the task; must run at module scope of the entry file. */
export function defineRefreshTask(): void {
  if (TaskManager.isTaskDefined(REFRESH_TASK)) return;
  TaskManager.defineTask(REFRESH_TASK, async () => {
    try {
      const outcome = await runRefresh(await liveRefreshDeps());
      console.log(`[struja-refresh] ${new Date().toISOString()} ${outcome}`);
      return outcome === 'failed'
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Registers the periodic refresh with the system. Idempotent; a platform without it is fine. */
export async function registerRefreshTask(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(REFRESH_TASK, {
      minimumInterval: REFRESH_INTERVAL_MINUTES,
    });
  } catch {
    // no background tasks here (the emulator without Play services, iOS until Phase 6 [MAC])
  }
}
