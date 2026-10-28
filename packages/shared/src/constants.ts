// An address, up to this many per device. One of them is primary.
export const MAX_ADDRESSES = 3;

// Europe/Belgrade poll times of the production scheduler (and the fixture collector).
export const POLL_HOURS = [7, 13, 19] as const;

// Quiet hours default: no notifications 22:00-07:00 unless the outage starts within 2 hours.
export const DEFAULT_QUIET_HOURS = { start: '22:00', end: '07:00' } as const;
export const URGENT_WITHIN_HOURS = 2;

export interface CityInfo {
  // Stable id used in URLs.
  id: string;
  // The collector's slug for the city's EDS pages.
  slug: string;
  name: string;
  // false = shown as "Uskoro" in the app.
  active: boolean;
}

// The app covers Niš only for now; the rest are listed so the picker can show "Uskoro".
export const CITIES: readonly CityInfo[] = [
  { id: 'nis', slug: 'Nis', name: 'Niš', active: true },
  { id: 'beograd', slug: 'Beograd', name: 'Beograd', active: false },
  { id: 'novi-sad', slug: 'NoviSad', name: 'Novi Sad', active: false },
  { id: 'kragujevac', slug: 'Kragujevac', name: 'Kragujevac', active: false },
  { id: 'kraljevo', slug: 'Kraljevo', name: 'Kraljevo', active: false },
];

// Development builds of the app have no Expo push token (that needs FCM credentials, Phase 4).
// They register with a token of this separate format instead. A development server accepts it, a
// production server rejects it. It is never an ExponentPushToken.
export const DEV_PUSH_TOKEN_PREFIX = 'dev-token:';
export const isDevPushToken = (token: string): boolean => token.startsWith(DEV_PUSH_TOKEN_PREFIX);
// A real token from Expo's push service (`ExponentPushToken[...]` or `ExpoPushToken[...]`).
export const isExpoPushToken = (token: string): boolean =>
  /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

// Android notification channels (BRIEF §5): one per kind, "hitno" for the urgent ones. The ids are
// what the server puts in the push and what the app creates on the device; they never change
// (Android fixes a channel's importance at creation: a different importance needs a new id).
export const NOTIFICATION_CHANNELS = [
  'new',
  'evening_before',
  'changed',
  'cancelled',
  'hitno',
] as const;
export type NotificationChannelId = (typeof NOTIFICATION_CHANNELS)[number];
/** The channel of a kind that is not urgent: `reinstated` shares the "Izmena" channel. */
export const channelForKind = (
  kind: 'new' | 'evening_before' | 'changed' | 'cancelled' | 'reinstated',
): NotificationChannelId => (kind === 'reinstated' ? 'changed' : kind);
export const URGENT_CHANNEL: NotificationChannelId = 'hitno';

// The notification category with the two actions (BRIEF §5): the server names it in the push, the app
// registers it with the buttons.
export const OUTAGE_CATEGORY = 'outage';
export const NOTIFICATION_ACTIONS = { details: 'detalji', calendar: 'kalendar' } as const;
