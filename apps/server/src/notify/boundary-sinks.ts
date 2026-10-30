import { createSign } from 'node:crypto';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { z } from 'zod';
import {
  BOUNDARY_TTL_SECONDS,
  isExpoPushToken,
  type BoundaryPush,
  type BoundaryPushType,
} from '@struja/shared';
import type { BoundaryRecipient, BoundarySignal, BoundarySink } from '../jobs/boundary.ts';
import type { ExpoClient } from './expo.ts';

// The outage start / end signals as data-only pushes (docs/phase4-plan.md §3 step 3). Two sinks send
// the same payload (packages/shared/src/boundary.ts): `ExpoBoundarySink` through Expo's push
// service, `FcmDirectSink` straight to FCM v1 with the Firebase service account key, chosen with
// `BOUNDARY_SINK`. A sink throws when a send may be retried (network, 5xx): the boundary tick then
// releases its claim and tries again a minute later. Dead tokens are reported, never thrown.

export interface BoundaryDelivery {
  recipient: BoundaryRecipient;
  push: BoundaryPush;
}

/** One push per affected address (a device with two affected addresses gets two). */
export function boundaryPushes(type: BoundaryPushType, s: BoundarySignal): BoundaryDelivery[] {
  return s.recipients.map((recipient) => ({
    recipient,
    push: {
      type,
      outageId: s.outageId,
      subscriptionId: recipient.subscriptionId,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      possible: recipient.possible,
    },
  }));
}

export type Log = (message: string) => void;
/** Called with the device id when the push service says the app is gone (uninstalled). */
export type DeadDeviceHandler = (deviceId: string) => Promise<void>;

interface SinkOptions {
  onDeadDevice?: DeadDeviceHandler;
  log?: Log;
}

// ------------------------------------------------------------------ Expo's push service

/**
 * The data-only message: no title, no body (Android shows nothing and runs the app's background
 * task; `contentAvailable` is the iOS equivalent, Phase 6 [MAC]). High priority so a dozing phone
 * is woken for it; the TTL keeps a late delivery from arriving after the fact.
 */
export function toExpoDataMessage(d: BoundaryDelivery): ExpoPushMessage {
  return {
    to: d.recipient.pushToken,
    data: d.push,
    priority: 'high',
    ttl: BOUNDARY_TTL_SECONDS[d.push.type],
    contentAvailable: true,
  };
}

export class ExpoBoundarySink implements BoundarySink {
  private readonly expo: ExpoClient;
  private readonly onDeadDevice: DeadDeviceHandler | undefined;
  private readonly log: Log;

  constructor(options: { accessToken?: string; client?: ExpoClient } & SinkOptions = {}) {
    this.expo =
      options.client ?? new Expo(options.accessToken ? { accessToken: options.accessToken } : {});
    this.onDeadDevice = options.onDeadDevice;
    this.log = options.log ?? ((m) => console.log(m));
  }

  started(s: BoundarySignal) {
    return this.send('outage_started', s);
  }

  ended(s: BoundarySignal) {
    return this.send('outage_ended', s);
  }

  private async send(type: BoundaryPushType, s: BoundarySignal): Promise<void> {
    // A development token has no push service behind it; the development stack logs it instead.
    const deliveries = boundaryPushes(type, s).filter((d) => {
      if (isExpoPushToken(d.recipient.pushToken)) return true;
      this.log(`[signal:${type}] outage ${s.outageId}: no real token for ${d.recipient.deviceId}`);
      return false;
    });
    if (deliveries.length === 0) return;
    const messages = deliveries.map(toExpoDataMessage);
    // The chunks keep the order of `messages`, so a ticket's index is its delivery's index.
    let i = 0;
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk); // throws: retried next tick
      for (const t of tickets) {
        const d = deliveries[i++];
        if (!d || t.status === 'ok') continue;
        const error = t.details?.error ?? t.message;
        if (error === 'DeviceNotRegistered') await this.onDeadDevice?.(d.recipient.deviceId);
        else this.log(`[signal:${type}] outage ${s.outageId}: ${d.recipient.deviceId}: ${error}`);
      }
    }
  }
}

// ------------------------------------------------------------------ FCM v1 directly

export const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.email(),
  private_key: z.string().includes('PRIVATE KEY'),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

/** Parses `FCM_SERVICE_ACCOUNT_JSON` (the key file's content as one line); throws on a wrong one. */
export function parseServiceAccount(json: string): ServiceAccount {
  const r = serviceAccountSchema.safeParse(JSON.parse(json));
  if (!r.success) {
    throw new Error(
      `FCM_SERVICE_ACCOUNT_JSON is not a service account key: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  return r.data;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const fcmSendUrl = (projectId: string) =>
  `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

const base64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/**
 * The signed JWT Google exchanges for an access token (RS256, at most one hour; see
 * developers.google.com/identity/protocols/oauth2/service-account).
 */
export function signAssertion(account: ServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(account.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

/** The FCM v1 request body for one delivery: the same JSON under the `body` data key as Expo's path. */
export function toFcmMessage(d: BoundaryDelivery): Record<string, unknown> {
  return {
    message: {
      token: d.recipient.nativePushToken,
      data: { body: JSON.stringify(d.push) },
      android: {
        priority: 'HIGH',
        ttl: `${BOUNDARY_TTL_SECONDS[d.push.type]}s`,
      },
    },
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class FcmDirectSink implements BoundarySink {
  private readonly account: ServiceAccount;
  private readonly fetch: Fetch;
  private readonly now: () => Date;
  private readonly onDeadDevice: DeadDeviceHandler | undefined;
  private readonly log: Log;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    account: ServiceAccount,
    options: { fetch?: Fetch; now?: () => Date } & SinkOptions = {},
  ) {
    this.account = account;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
    this.onDeadDevice = options.onDeadDevice;
    this.log = options.log ?? ((m) => console.log(m));
  }

  started(s: BoundarySignal) {
    return this.send('outage_started', s);
  }

  ended(s: BoundarySignal) {
    return this.send('outage_ended', s);
  }

  /** The cached access token, renewed a minute before it expires. */
  async accessToken(): Promise<string> {
    const nowMs = this.now().getTime();
    if (this.token && this.token.expiresAt - 60_000 > nowMs) return this.token.value;
    const res = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signAssertion(this.account, Math.floor(nowMs / 1000)),
      }).toString(),
    });
    if (!res.ok) throw new Error(`FCM token request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('FCM token request returned no access token');
    this.token = { value: body.access_token, expiresAt: nowMs + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async send(type: BoundaryPushType, s: BoundarySignal): Promise<void> {
    const deliveries = boundaryPushes(type, s).filter((d) => {
      if (d.recipient.nativePushToken) return true;
      this.log(`[signal:${type}] outage ${s.outageId}: no FCM token for ${d.recipient.deviceId}`);
      return false;
    });
    if (deliveries.length === 0) return;
    const token = await this.accessToken();
    const url = fcmSendUrl(this.account.project_id);
    let retryable: string | null = null;
    for (const d of deliveries) {
      const res = await this.fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(toFcmMessage(d)),
      });
      if (res.ok) continue;
      const text = await res.text();
      // 404 UNREGISTERED: the app is gone from the phone. A bad token is 400 INVALID_ARGUMENT:
      // the device is kept (its Expo token may still be fine) and the line is logged.
      if (res.status === 404 && /UNREGISTERED/.test(text)) {
        await this.onDeadDevice?.(d.recipient.deviceId);
      } else if (res.status === 429 || res.status >= 500) {
        retryable = `HTTP ${res.status}`;
      } else {
        this.log(
          `[signal:${type}] outage ${s.outageId}: ${d.recipient.deviceId}: HTTP ${res.status} ${text.slice(0, 200)}`,
        );
      }
    }
    if (retryable) throw new Error(`FCM send failed (${retryable}); retried next tick`);
  }
}
