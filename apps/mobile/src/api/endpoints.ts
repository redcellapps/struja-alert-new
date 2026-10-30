import {
  citiesResponseSchema,
  createSubscriptionRequestSchema,
  cityOutagesResponseSchema,
  createReportResponseSchema,
  deviceSchema,
  gazetteerResponseSchema,
  myOutagesResponseSchema,
  outageDetailSchema,
  registerDeviceResponseSchema,
  subscriptionsResponseSchema,
  subscriptionWithOutagesSchema,
  type CreateSubscriptionRequest,
  type GazetteerResponse,
} from '@struja/shared';
import type { z } from 'zod';
import type { ApiClient } from './client';

const entityTag = (etag: string): string =>
  etag.startsWith('"') || etag.startsWith('W/') ? etag : `"${etag}"`;

// One typed function per /v1 endpoint (docs/api.md). Screens never build URLs themselves.
export function endpoints(client: ApiClient) {
  return {
    cities: () => client.request({ path: '/v1/cities', schema: citiesResponseSchema }),

    // Conditional: null when the cached copy (identified by its ETag) is still current. `etag` is the
    // bare value from the body; If-None-Match carries it as an HTTP entity-tag, in quotes (the server
    // answers 304 only for that form).
    async gazetteer(city: string, etag?: string): Promise<GazetteerResponse | null> {
      const res = await client.raw({
        path: `/v1/cities/${city}/gazetteer`,
        headers: etag ? { 'if-none-match': entityTag(etag) } : undefined,
      });
      if (res.status === 304) return null;
      if (!res.ok) throw new Error(`gazetteer: HTTP ${res.status}`);
      return gazetteerResponseSchema.parse(await res.json());
    },

    cityOutages: (city: string, date?: string) =>
      client.request({
        path: `/v1/cities/${city}/outages${date ? `?date=${encodeURIComponent(date)}` : ''}`,
        schema: cityOutagesResponseSchema,
      }),

    registerDevice: (body: {
      pushToken: string;
      nativePushToken?: string;
      platform: 'android' | 'ios';
      osVersion?: string;
      locale: 'sr' | 'en';
      script: 'latn' | 'cyrl';
    }) =>
      client.request({
        method: 'POST',
        path: '/v1/devices',
        body,
        schema: registerDeviceResponseSchema,
      }),
    device: () => client.request({ path: '/v1/devices/me', schema: deviceSchema, auth: true }),
    patchDevice: (body: Record<string, unknown>) =>
      client.request({
        method: 'PATCH',
        path: '/v1/devices/me',
        body,
        schema: deviceSchema,
        auth: true,
      }),
    deleteMyData: () =>
      client.request({ method: 'DELETE', path: '/v1/devices/me', auth: true }) as Promise<void>,

    subscriptions: () =>
      client.request({
        path: '/v1/subscriptions',
        schema: subscriptionsResponseSchema,
        auth: true,
      }),
    addSubscription: (body: z.input<typeof createSubscriptionRequestSchema>) =>
      client.request({
        method: 'POST',
        path: '/v1/subscriptions',
        body,
        schema: subscriptionWithOutagesSchema,
        auth: true,
      }),
    patchSubscription: (id: number, body: Record<string, unknown>) =>
      client.request({
        method: 'PATCH',
        path: `/v1/subscriptions/${id}`,
        body,
        schema: subscriptionWithOutagesSchema,
        auth: true,
      }),
    deleteSubscription: (id: number) =>
      client.request({
        method: 'DELETE',
        path: `/v1/subscriptions/${id}`,
        auth: true,
      }) as Promise<void>,

    myOutages: (range: 'upcoming' | 'history' = 'upcoming') =>
      client.request({
        path: `/v1/me/outages?range=${range}`,
        schema: myOutagesResponseSchema,
        auth: true,
      }),
    outage: (id: number) =>
      client.request({ path: `/v1/outages/${id}`, schema: outageDetailSchema, auth: 'optional' }),

    report: (body: { outageId?: number; subscriptionId?: number; message: string }) =>
      client.request({
        method: 'POST',
        path: '/v1/reports',
        body,
        schema: createReportResponseSchema,
        auth: true,
      }),
  };
}
export type Endpoints = ReturnType<typeof endpoints>;
export type { CreateSubscriptionRequest };
