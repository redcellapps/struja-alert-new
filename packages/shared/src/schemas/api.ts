import { z } from 'zod';
import { MAX_ADDRESSES } from '../constants.ts';

// The /v1 contracts shared by the server and the app. Dates are ISO-8601 strings in UTC.
export const NOTIFICATION_KINDS = ['new', 'evening_before', 'changed', 'cancelled'] as const;
export const kindSchema = z.enum(NOTIFICATION_KINDS);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
export const quietHoursSchema = z.object({ start: hhmm, end: hhmm });
export type QuietHoursDto = z.infer<typeof quietHoursSchema>;

// ---------------------------------------------------------------- devices

export const registerDeviceRequestSchema = z.object({
  pushToken: z.string().min(8).max(300),
  platform: z.enum(['android', 'ios']),
  osVersion: z.string().max(40).optional(),
  locale: z.enum(['sr', 'en']).default('sr'),
  script: z.enum(['latn', 'cyrl']).default('latn'),
});
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

// The secret is shown once; the app keeps it in secure storage and sends it as
// `Authorization: Bearer <deviceId>.<deviceSecret>`.
export const registerDeviceResponseSchema = z.object({
  deviceId: z.string().uuid(),
  deviceSecret: z.string(),
});

export const patchDeviceRequestSchema = z
  .object({
    pushToken: z.string().min(8).max(300),
    locale: z.enum(['sr', 'en']),
    script: z.enum(['latn', 'cyrl']),
    quietHours: quietHoursSchema.nullable(),
    enabledKinds: z.array(kindSchema),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export const deviceSchema = z.object({
  id: z.string().uuid(),
  platform: z.enum(['android', 'ios']),
  locale: z.enum(['sr', 'en']),
  script: z.enum(['latn', 'cyrl']),
  quietHours: quietHoursSchema.nullable(),
  enabledKinds: z.array(kindSchema),
});
export type DeviceDto = z.infer<typeof deviceSchema>;

// ---------------------------------------------------------------- subscriptions

export const createSubscriptionRequestSchema = z
  .object({
    city: z.string().default('nis'),
    streetId: z.number().int().positive().optional(),
    settlementId: z.number().int().positive().optional(),
    houseNumber: z.number().int().min(1).max(9999).optional(),
    houseSuffix: z.string().max(3).optional(),
    label: z.string().max(40).optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((v) => (v.streetId !== undefined) !== (v.settlementId !== undefined), {
    message: 'Give either streetId or settlementId',
  });
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;

export const patchSubscriptionRequestSchema = z
  .object({
    label: z.string().max(40).nullable(),
    isPrimary: z.boolean(),
    houseNumber: z.number().int().min(1).max(9999).nullable(),
    houseSuffix: z.string().max(3).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export const subscriptionSchema = z.object({
  id: z.number().int(),
  streetId: z.number().int().nullable(),
  settlementId: z.number().int().nullable(),
  name: z.object({ latin: z.string(), cyrillic: z.string() }),
  houseNumber: z.number().int().nullable(),
  houseSuffix: z.string().nullable(),
  label: z.string().nullable(),
  isPrimary: z.boolean(),
});
export type SubscriptionDto = z.infer<typeof subscriptionSchema>;

// An outage as it concerns one saved address.
export const addressOutageSchema = z.object({
  id: z.number().int(),
  subscriptionId: z.number().int(),
  // `cancelled` outages are shown struck through; replaced rows never appear.
  status: z.enum(['active', 'changed', 'cancelled']),
  startsAt: z.string(),
  endsAt: z.string(),
  outageDate: z.string(),
  municipality: z.string(),
  revision: z.number().int(),
  // "possible" = Moguće pogođeno: why we cannot be sure.
  match: z.enum(['affected', 'possible']),
  reason: z.enum(['no_number', 'partial', 'unresolved', 'same_name']).nullable(),
});
export type AddressOutageDto = z.infer<typeof addressOutageSchema>;

// Adding an address returns what is already published for it (nothing is pushed for those).
export const subscriptionWithOutagesSchema = z.object({
  subscription: subscriptionSchema,
  outages: z.array(addressOutageSchema),
});
export const subscriptionsResponseSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
  max: z.literal(MAX_ADDRESSES),
});
export const myOutagesResponseSchema = z.object({ outages: z.array(addressOutageSchema) });

// ---------------------------------------------------------------- outages

export const outageSegmentSchema = z.object({
  raw: z.string(),
  kind: z.enum(['street', 'settlement', 'unresolved']),
  name: z.object({ latin: z.string(), cyrillic: z.string() }).nullable(),
  // The street this segment is, to follow exactly that one; null for a settlement, or a name that
  // several streets share and the notice does not place.
  streetId: z.number().int().nullable(),
  partial: z.boolean(),
  ranges: z.array(
    z.object({
      raw: z.string(),
      from: z.number().int().nullable(),
      to: z.number().int().nullable(),
      parity: z.enum(['odd', 'even']).nullable(),
    }),
  ),
});

export const outageDetailSchema = z.object({
  id: z.number().int(),
  city: z.string(),
  municipality: z.string(),
  outageDate: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(['active', 'changed', 'cancelled']),
  revision: z.number().int(),
  // The Ulice cell exactly as EDS published it.
  rawStreets: z.string(),
  segments: z.array(outageSegmentSchema),
  // GeoJSON of the resolved streets, for the map.
  geometry: z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(z.any()),
  }),
  source: z.object({ name: z.string(), url: z.string() }),
  // Present when the caller is authenticated: how this outage concerns their addresses.
  mine: z.array(
    z.object({
      subscriptionId: z.number().int(),
      match: z.enum(['affected', 'possible']),
      reason: z.enum(['no_number', 'partial', 'unresolved', 'same_name']).nullable(),
      // The person's house on the map: only for an address with a number that OSM has a point for.
      point: z.object({ lng: z.number(), lat: z.number() }).nullable(),
    }),
  ),
});
export type OutageDetailDto = z.infer<typeof outageDetailSchema>;

export const cityOutageSchema = z.object({
  id: z.number().int(),
  municipality: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  outageDate: z.string(),
  status: z.enum(['active', 'changed', 'cancelled']),
  streets: z.array(z.string()),
});
export const cityOutagesResponseSchema = z.object({
  city: z.string(),
  outages: z.array(cityOutageSchema),
});

// ---------------------------------------------------------------- reports

export const createReportRequestSchema = z.object({
  outageId: z.number().int().positive().optional(),
  subscriptionId: z.number().int().positive().optional(),
  message: z.string().min(3).max(1000),
});
export const createReportResponseSchema = z.object({ id: z.number().int() });
