import { describe, expect, it } from 'vitest';
import type { ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket } from 'expo-server-sdk';
import { ExpoPushProvider, toExpoMessage, type ExpoClient } from '../src/notify/expo.ts';
import type { PushMessage } from '../src/notify/provider.ts';

const message = (over: Partial<PushMessage> = {}): PushMessage => ({
  to: 'ExponentPushToken[abc]',
  title: 'Isključenje struje: Trebinjska, sre 11:00–16:00',
  body: 'Trebinjska 34',
  data: { outageId: 7, kind: 'new', link: 'strujaalert://outage/7' },
  channelId: 'new',
  groupKey: 'address-15',
  urgent: false,
  ...over,
});

// Expo's client, without the network: records what was sent and answers what it is told to.
class FakeExpo implements ExpoClient {
  sent: ExpoPushMessage[][] = [];
  tickets: ExpoPushTicket[] = [];
  receipts: Record<string, ExpoPushReceipt> = {};
  failChunks = false;
  chunkPushNotifications(messages: ExpoPushMessage[]) {
    const out: ExpoPushMessage[][] = [];
    for (let i = 0; i < messages.length; i += 2) out.push(messages.slice(i, i + 2));
    return out;
  }
  async sendPushNotificationsAsync(messages: ExpoPushMessage[]) {
    if (this.failChunks) throw new Error('Expo is down');
    this.sent.push(messages);
    return this.tickets.splice(0, messages.length);
  }
  chunkPushNotificationReceiptIds(ids: string[]) {
    return [ids];
  }
  async getPushNotificationReceiptsAsync(ids: string[]) {
    return Object.fromEntries(
      ids.filter((id) => this.receipts[id]).map((id) => [id, this.receipts[id]!]),
    );
  }
}

describe('the Expo push message', () => {
  it('a silent message is data-only: no title, body, channel or category; high priority, an hour of TTL', () => {
    const m = toExpoMessage(message({ silent: true, title: 'ignored', body: 'ignored' }));
    expect(m).toEqual({
      to: 'ExponentPushToken[abc]',
      data: { outageId: 7, kind: 'new', link: 'strujaalert://outage/7' },
      priority: 'high',
      ttl: 3600,
      contentAvailable: true,
    });
  });

  it('carries the channel, the category with the two actions, the address as iOS thread and Android tag, and high priority', () => {
    const m = toExpoMessage(message());
    expect(m).toMatchObject({
      to: 'ExponentPushToken[abc]',
      channelId: 'new',
      categoryId: 'outage',
      threadId: 'address-15',
      // Android replaces a shown notification with the same tag: one line per address in the shade.
      tag: 'address-15',
      priority: 'high',
      sound: 'default',
      data: { outageId: 7, link: 'strujaalert://outage/7' },
    });
    expect(m.ttl).toBeGreaterThan(0);
    expect(m.interruptionLevel).toBeUndefined();
  });

  it('is time-sensitive on iOS when urgent, on the "hitno" channel on Android', () => {
    const m = toExpoMessage(message({ urgent: true, channelId: 'hitno' }));
    expect(m.interruptionLevel).toBe('time-sensitive');
    expect(m.channelId).toBe('hitno');
  });
});

describe('ExpoPushProvider', () => {
  it('sends in chunks and maps tickets, including an error ticket', async () => {
    const expo = new FakeExpo();
    expo.tickets = [
      { status: 'ok', id: 'r1' },
      { status: 'error', message: 'bad token', details: { error: 'DeviceNotRegistered' } },
      { status: 'ok', id: 'r3' },
    ];
    const provider = new ExpoPushProvider({ client: expo });
    const tickets = await provider.send([
      message(),
      message({ to: 'ExponentPushToken[dead]' }),
      message(),
    ]);
    expect(expo.sent.map((c) => c.length)).toEqual([2, 1]);
    expect(tickets).toEqual([
      { status: 'ok', id: 'r1' },
      { status: 'error', error: 'DeviceNotRegistered' },
      { status: 'ok', id: 'r3' },
    ]);
  });

  it('turns a failed chunk into error tickets for each of its messages (they are retried later)', async () => {
    const expo = new FakeExpo();
    expo.failChunks = true;
    const provider = new ExpoPushProvider({ client: expo });
    const tickets = await provider.send([message(), message(), message()]);
    expect(tickets).toHaveLength(3);
    expect(tickets.every((t) => t.status === 'error' && t.error === 'Expo is down')).toBe(true);
  });

  it('reads receipts and reports a dead device', async () => {
    const expo = new FakeExpo();
    expo.receipts = {
      r1: { status: 'ok' },
      r2: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    };
    const provider = new ExpoPushProvider({ client: expo });
    const receipts = await provider.getReceipts(['r1', 'r2', 'r3']);
    expect(receipts).toEqual({
      r1: { status: 'ok' },
      r2: { status: 'error', error: 'DeviceNotRegistered' },
    });
    // r3 is not there yet: the receipts job asks again later
    expect(receipts['r3']).toBeUndefined();
  });
});
