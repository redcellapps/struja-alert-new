import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from 'expo-server-sdk';
import { OUTAGE_CATEGORY } from '@struja/shared';
import type { PushMessage, PushProvider, PushReceipt, PushTicket } from './provider.ts';

// The part of the Expo client this provider uses (so the tests can hand in a fake).
export interface ExpoClient {
  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
  sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  chunkPushNotificationReceiptIds(ids: string[]): string[][];
  getPushNotificationReceiptsAsync(ids: string[]): Promise<Record<string, ExpoPushReceipt>>;
}

// Delivery may be retried this long; a message kept longer than this would arrive stale.
const TTL_SECONDS = 6 * 3600;

/** What one of our notifications looks like to Expo's push service (FCM v1 on Android, APNs on iOS). */
export function toExpoMessage(m: PushMessage): ExpoPushMessage {
  return {
    to: m.to,
    title: m.title,
    body: m.body,
    data: m.data,
    // Android: the channel decides sound and importance; the person tunes it in the system settings.
    channelId: m.channelId,
    // The app registers this category with the "Detalji" and "Dodaj u kalendar" buttons.
    categoryId: OUTAGE_CATEGORY,
    // One notification per saved address. iOS: a thread, so the system stacks them. Android: Expo's
    // push service sends no group (measured 29 Oct on the HONOR), so the same key goes as the
    // notification tag instead: a newer notification for the address replaces the one in the shade,
    // and the shade shows one line per address with the latest state (decided 29 Oct).
    threadId: m.groupKey,
    tag: m.groupKey,
    // Every notification of ours is about a coming or current outage: worth waking the device for.
    priority: 'high',
    ttl: TTL_SECONDS,
    sound: 'default',
    ...(m.urgent ? { interruptionLevel: 'time-sensitive' as const } : {}),
  };
}

/**
 * Real delivery through Expo's push service (BRIEF §5). Sends in Expo's chunks, keeps the ticket
 * ids for the receipts job, and reports `DeviceNotRegistered` so the device is dropped. Needs the
 * FCM V1 service account key uploaded to EAS (docs/phase4-plan.md §0) and, optionally, an Expo access
 * token (`EXPO_ACCESS_TOKEN`) so that only this server may push with the project's tokens.
 */
export class ExpoPushProvider implements PushProvider {
  private readonly expo: ExpoClient;

  constructor(options: { accessToken?: string; client?: ExpoClient } = {}) {
    this.expo =
      options.client ?? new Expo(options.accessToken ? { accessToken: options.accessToken } : {});
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (const chunk of this.expo.chunkPushNotifications(messages.map(toExpoMessage))) {
      try {
        const got = await this.expo.sendPushNotificationsAsync(chunk);
        for (const t of got) {
          tickets.push(
            t.status === 'ok'
              ? { status: 'ok', id: t.id }
              : { status: 'error', error: t.details?.error ?? t.message },
          );
        }
      } catch (e) {
        // The whole chunk failed (network, Expo down): every message of it is retried later.
        const error = e instanceof Error ? e.message : String(e);
        for (let i = 0; i < chunk.length; i++) tickets.push({ status: 'error', error });
      }
    }
    return tickets;
  }

  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    const out: Record<string, PushReceipt> = {};
    for (const chunk of this.expo.chunkPushNotificationReceiptIds(ids)) {
      const got = await this.expo.getPushNotificationReceiptsAsync(chunk);
      for (const [id, r] of Object.entries(got)) {
        out[id] =
          r.status === 'ok'
            ? { status: 'ok' }
            : { status: 'error', error: r.details?.error ?? r.message };
      }
    }
    return out;
  }
}
