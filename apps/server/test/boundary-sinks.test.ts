import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket } from 'expo-server-sdk';
import { describe, expect, it } from 'vitest';
import { boundaryPushSchema } from '@struja/shared';
import type { BoundaryRecipient, BoundarySignal } from '../src/jobs/boundary.ts';
import {
  boundaryPushes,
  ExpoBoundarySink,
  FcmDirectSink,
  fcmSendUrl,
  parseServiceAccount,
  signAssertion,
  toExpoDataMessage,
  toFcmMessage,
  type ServiceAccount,
} from '../src/notify/boundary-sinks.ts';
import type { ExpoClient } from '../src/notify/expo.ts';

const recipient = (over: Partial<BoundaryRecipient> = {}): BoundaryRecipient => ({
  subscriptionId: 15,
  deviceId: 'dev-a',
  pushToken: 'ExponentPushToken[a]',
  nativePushToken: 'fcm-a',
  platform: 'android',
  possible: false,
  ...over,
});

const signal = (recipients: BoundaryRecipient[] = [recipient()]): BoundarySignal => ({
  outageId: 7,
  startsAt: new Date('2026-11-03T10:00:00Z'),
  endsAt: new Date('2026-11-03T15:00:00Z'),
  recipients,
});

class FakeExpo implements ExpoClient {
  sent: ExpoPushMessage[][] = [];
  tickets: ExpoPushTicket[] = [];
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
  async getPushNotificationReceiptsAsync(): Promise<Record<string, ExpoPushReceipt>> {
    return {};
  }
}

describe('the boundary push payload', () => {
  it('is one push per affected address, in the shared schema', () => {
    const pushes = boundaryPushes(
      'outage_started',
      signal([recipient(), recipient({ subscriptionId: 16, possible: true })]),
    );
    expect(pushes).toHaveLength(2);
    expect(boundaryPushSchema.parse(pushes[0]!.push)).toEqual({
      type: 'outage_started',
      outageId: 7,
      subscriptionId: 15,
      startsAt: '2026-11-03T10:00:00.000Z',
      endsAt: '2026-11-03T15:00:00.000Z',
      possible: false,
    });
    expect(pushes[1]!.push).toMatchObject({ subscriptionId: 16, possible: true });
  });

  it('goes to Expo as a data-only message: no title or body, high priority, a short TTL', () => {
    const [start] = boundaryPushes('outage_started', signal());
    const [end] = boundaryPushes('outage_ended', signal());
    const m = toExpoDataMessage(start!);
    expect(m.title).toBeUndefined();
    expect(m.body).toBeUndefined();
    expect(m).toMatchObject({
      to: 'ExponentPushToken[a]',
      priority: 'high',
      ttl: 3600,
      contentAvailable: true,
      data: { type: 'outage_started', outageId: 7 },
    });
    expect(toExpoDataMessage(end!).ttl).toBe(900);
  });

  it('goes to FCM as the same JSON under the "body" data key, Android high priority and TTL', () => {
    const [end] = boundaryPushes('outage_ended', signal());
    const m = toFcmMessage(end!) as { message: Record<string, unknown> };
    expect(m.message).toMatchObject({
      token: 'fcm-a',
      android: { priority: 'HIGH', ttl: '900s' },
    });
    expect(m.message['notification']).toBeUndefined();
    const data = m.message['data'] as { body: string };
    expect(boundaryPushSchema.parse(JSON.parse(data.body))).toMatchObject({
      type: 'outage_ended',
      outageId: 7,
      subscriptionId: 15,
    });
  });
});

describe('ExpoBoundarySink', () => {
  it('sends to real tokens only, and drops a device the service says is gone', async () => {
    const expo = new FakeExpo();
    expo.tickets = [
      { status: 'ok', id: 't1' },
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    ];
    const dead: string[] = [];
    const lines: string[] = [];
    const sink = new ExpoBoundarySink({
      client: expo,
      onDeadDevice: async (id) => void dead.push(id),
      log: (m) => lines.push(m),
    });
    await sink.started(
      signal([
        recipient(),
        recipient({ deviceId: 'dev-b', pushToken: 'ExponentPushToken[b]' }),
        recipient({ deviceId: 'dev-c', pushToken: 'dev-token:local' }),
      ]),
    );
    expect(expo.sent.flat().map((m) => m.to)).toEqual([
      'ExponentPushToken[a]',
      'ExponentPushToken[b]',
    ]);
    expect(dead).toEqual(['dev-b']);
    expect(lines.join('\n')).toMatch(/no real token for dev-c/);
  });

  it('throws when the service is down, so the tick retries', async () => {
    const expo = new FakeExpo();
    expo.failChunks = true;
    const sink = new ExpoBoundarySink({ client: expo, log: () => {} });
    await expect(sink.ended(signal())).rejects.toThrow(/Expo is down/);
  });

  it('sends nothing for an outage nobody follows', async () => {
    const expo = new FakeExpo();
    await new ExpoBoundarySink({ client: expo }).started(signal([]));
    expect(expo.sent).toEqual([]);
  });
});

describe('FcmDirectSink', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account: ServiceAccount = {
    project_id: 'struja-alert-test',
    client_email: 'push@struja-alert-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };

  interface Call {
    url: string;
    init: RequestInit;
  }

  // Google's two endpoints, without the network: the token exchange and the send.
  function fakeGoogle(answer: (call: Call) => Response | undefined) {
    const calls: Call[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      if (url === 'https://oauth2.googleapis.com/token') {
        return Response.json({ access_token: 'ya29.test', expires_in: 3600, token_type: 'Bearer' });
      }
      return answer(call) ?? Response.json({ name: 'projects/x/messages/1' });
    };
    return { calls, fetch };
  }

  it('signs a one-hour RS256 assertion for the messaging scope', () => {
    const jwt = signAssertion(account, 1_700_000_000);
    const [header, claims, signature] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const ok = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(ok).toBe(true);
  });

  it('exchanges the assertion once, then sends each push with the bearer token', async () => {
    const google = fakeGoogle(() => undefined);
    let now = new Date('2026-11-03T10:00:00Z');
    const sink = new FcmDirectSink(account, { fetch: google.fetch, now: () => now });
    await sink.started(signal([recipient(), recipient({ deviceId: 'dev-b', subscriptionId: 16 })]));
    now = new Date('2026-11-03T10:30:00Z');
    await sink.ended(signal());

    const tokenCalls = google.calls.filter((c) => c.url.includes('oauth2'));
    expect(tokenCalls).toHaveLength(1);
    expect(String(tokenCalls[0]!.init.body)).toMatch(
      /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/,
    );
    const sends = google.calls.filter((c) => c.url === fcmSendUrl('struja-alert-test'));
    expect(sends).toHaveLength(3);
    const headers = sends[0]!.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer ya29.test');
    expect(headers['content-type']).toBe('application/json');
    const bodies = sends.map((c) => JSON.parse(String(c.init.body)).message);
    expect(bodies.map((m) => JSON.parse(m.data.body).type)).toEqual([
      'outage_started',
      'outage_started',
      'outage_ended',
    ]);
  });

  it('renews the token when it is about to expire', async () => {
    const google = fakeGoogle(() => undefined);
    let now = new Date('2026-11-03T10:00:00Z');
    const sink = new FcmDirectSink(account, { fetch: google.fetch, now: () => now });
    await sink.started(signal());
    now = new Date('2026-11-03T10:59:30Z'); // 30 s before the hour: renewed
    await sink.ended(signal());
    expect(google.calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('skips a device without an FCM token, drops an unregistered one, logs a bad request', async () => {
    const google = fakeGoogle((call) => {
      const token = JSON.parse(String(call.init.body)).message.token as string;
      if (token === 'fcm-gone') {
        return Response.json(
          { error: { code: 404, status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
          { status: 404 },
        );
      }
      if (token === 'fcm-bad') {
        return Response.json(
          { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad token' } },
          { status: 400 },
        );
      }
      return undefined;
    });
    const dead: string[] = [];
    const lines: string[] = [];
    const sink = new FcmDirectSink(account, {
      fetch: google.fetch,
      onDeadDevice: async (id) => void dead.push(id),
      log: (m) => lines.push(m),
    });
    await sink.started(
      signal([
        recipient(),
        recipient({ deviceId: 'dev-none', nativePushToken: null }),
        recipient({ deviceId: 'dev-gone', nativePushToken: 'fcm-gone' }),
        recipient({ deviceId: 'dev-bad', nativePushToken: 'fcm-bad' }),
      ]),
    );
    expect(dead).toEqual(['dev-gone']);
    expect(lines.join('\n')).toMatch(/no FCM token for dev-none/);
    expect(lines.join('\n')).toMatch(/dev-bad: HTTP 400/);
    expect(google.calls.filter((c) => c.url.includes('messages:send'))).toHaveLength(3);
  });

  it('throws on a server error, after trying every recipient, so the tick retries', async () => {
    const google = fakeGoogle((call) =>
      JSON.parse(String(call.init.body)).message.token === 'fcm-a'
        ? new Response('upstream', { status: 503 })
        : undefined,
    );
    const sink = new FcmDirectSink(account, { fetch: google.fetch, log: () => {} });
    await expect(
      sink.started(
        signal([recipient(), recipient({ deviceId: 'dev-b', nativePushToken: 'fcm-b' })]),
      ),
    ).rejects.toThrow(/HTTP 503/);
    expect(google.calls.filter((c) => c.url.includes('messages:send'))).toHaveLength(2);
  });

  it('refuses a key file that is not a service account', () => {
    expect(() => parseServiceAccount('{"type":"authorized_user"}')).toThrow(
      /not a service account key: project_id, client_email, private_key/,
    );
    expect(parseServiceAccount(JSON.stringify(account)).project_id).toBe('struja-alert-test');
  });
});
