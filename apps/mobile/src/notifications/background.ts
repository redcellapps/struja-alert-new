import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { boundaryPushSchema, type BoundaryPush } from '@struja/shared';
import type { T } from '../home/format';
import { i18next, initI18n } from '../i18n';
import { storage, type KeyValueStorage } from '../store/storage';
import { useSettings } from '../store/settings';
import { showActive, showEnded, type ActiveOutage } from './active';
import {
  bookFromPush,
  endAlarmId,
  outagePushData,
  readBook,
  startAlarmId,
  syncAlarms,
  writeBook,
  type AlarmBook,
} from './alarms';

// The background task (docs/phase4-plan.md §3 step 3). On Android every push runs it, in every state
// of the app (expo-notifications hands each FCM message to expo-task-manager, which loads this bundle
// headless when the app is not running). It is defined at module scope from the entry file
// (apps/mobile/index.ts), so that the headless load finds it.
//
// Two kinds of push arrive here. The data-only "outage started" / "outage ended" signal is turned
// into the "Bez struje" / "Struja se vratila" notification and the matching alarm is cancelled. A
// notification push (new, changed, cancelled, ...) is shown by the system; here it only updates the
// alarm book, so the local alarms are right even when the app is never opened before the outage.

export const BACKGROUND_TASK = 'struja-alert-push';

export type ParsedPayload =
  | { kind: 'boundary'; push: BoundaryPush }
  | { kind: 'outage'; data: Record<string, unknown> }
  | { kind: 'other' };

/**
 * What a task payload is. On Android the app's `data` is a JSON string under `dataString` (Expo's
 * push service and the direct FCM sink both put it there); a parsed `data` object is accepted too
 * (the foreground listener hands one over), and so is a notification response (ignored).
 */
export function parsePayload(payload: unknown): ParsedPayload {
  if (!payload || typeof payload !== 'object') return { kind: 'other' };
  const p = payload as { data?: unknown; actionIdentifier?: unknown; notification?: unknown };
  if (typeof p.actionIdentifier === 'string') return { kind: 'other' }; // a tap: respond.ts
  let data: unknown = p.data;
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as { dataString?: unknown }).dataString === 'string'
  ) {
    try {
      data = JSON.parse((data as { dataString: string }).dataString);
    } catch {
      return { kind: 'other' };
    }
  } else if (
    data &&
    typeof data === 'object' &&
    typeof (data as { body?: unknown }).body === 'string'
  ) {
    try {
      data = JSON.parse((data as { body: string }).body);
    } catch {
      return { kind: 'other' };
    }
  }
  if (!data || typeof data !== 'object') return { kind: 'other' };
  const boundary = boundaryPushSchema.safeParse(data);
  if (boundary.success) return { kind: 'boundary', push: boundary.data };
  const record = data as Record<string, unknown>;
  return record['outageId'] !== undefined ? { kind: 'outage', data: record } : { kind: 'other' };
}

export interface TaskDeps {
  kv: KeyValueStorage;
  t: T;
  now: () => Date;
  showActive: (o: ActiveOutage, t: T) => Promise<void>;
  showEnded: (o: ActiveOutage, t: T) => Promise<void>;
  cancelAlarm: (identifier: string) => Promise<void>;
  syncAlarms: (book: AlarmBook, t: T, now: Date) => Promise<void>;
  // Called when the app's data may be stale (a running app refetches; a headless one does nothing).
  invalidate?: () => void;
}

/** What one push means for the phone. Pure apart from `deps`; the test drives it directly. */
export async function handlePayload(parsed: ParsedPayload, deps: TaskDeps): Promise<void> {
  if (parsed.kind === 'other') return;
  const book = readBook(deps.kv);
  if (parsed.kind === 'boundary') {
    const { push } = parsed;
    const known = book[String(push.outageId)];
    const outage: ActiveOutage = {
      outageId: push.outageId,
      subscriptionId: push.subscriptionId,
      address: known?.address ?? '',
      startsAt: push.startsAt,
      endsAt: push.endsAt,
    };
    if (push.type === 'outage_started') {
      // The push came first: the alarm for the same moment is not needed any more.
      await deps.cancelAlarm(startAlarmId(push.outageId));
      await deps.showActive(outage, deps.t);
    } else {
      await deps.cancelAlarm(endAlarmId(push.outageId));
      await deps.showEnded(outage, deps.t);
      const rest = { ...book };
      delete rest[String(push.outageId)];
      writeBook(rest, deps.kv);
    }
    deps.invalidate?.();
    return;
  }
  const push = outagePushData(parsed.data);
  if (!push) return;
  const next = bookFromPush(push, book);
  writeBook(next, deps.kv);
  await deps.syncAlarms(next, deps.t, deps.now());
  deps.invalidate?.();
}

/** The task's real dependencies: MMKV, the notification module and the i18n of the saved language. */
export async function liveDeps(invalidate?: () => void): Promise<TaskDeps> {
  const { language, script } = useSettings.getState();
  if (!i18next.isInitialized) await initI18n(language, script);
  return {
    kv: storage(),
    t: i18next.t.bind(i18next),
    now: () => new Date(),
    showActive,
    showEnded,
    cancelAlarm: (id) => Notifications.cancelScheduledNotificationAsync(id),
    syncAlarms,
    ...(invalidate ? { invalidate } : {}),
  };
}

let invalidateHook: (() => void) | undefined;
/** The running app registers how to refetch its data when a push changed something. */
export function setInvalidateHook(f: (() => void) | undefined): void {
  invalidateHook = f;
}

/** Defines the task. Must run at module scope of the entry file, before anything else loads. */
export function defineBackgroundTask(): void {
  if (TaskManager.isTaskDefined(BACKGROUND_TASK)) return;
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    BACKGROUND_TASK,
    async ({ data, error }) => {
      if (error) return;
      try {
        await handlePayload(parsePayload(data), await liveDeps(invalidateHook));
      } catch {
        // A broken push must not crash the headless process; the alarm book stays as it was.
      }
    },
  );
}

/** Registers the task with the system. Idempotent; called once the channels exist. */
export async function registerBackgroundTask(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(BACKGROUND_TASK);
  } catch {
    // No task manager on this platform (iOS until Phase 6 [MAC]); the alarms still work.
  }
}
