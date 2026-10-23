import type { AddressOutageDto, SubscriptionDto } from '@struja/shared';
import { outagesFor } from './fixtures.ts';

// Development-only scenarios of the mock API, so every state of Početna can be seen and screenshotted
// without waiting for a real outage. Set with `MOCK_SCENARIO=<name>` when starting the mock server, or
// at run time with `POST /__dev/scenario {"name": "<name>"}`. All times are relative to "now".
export const SCENARIOS = [
  'clear',
  'upcoming',
  'imminent',
  'active',
  'cancelled',
  'possible',
  'three',
  'offline',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const isScenario = (name: unknown): name is Scenario =>
  typeof name === 'string' && (SCENARIOS as readonly string[]).includes(name);

const MIN = 60_000;
const HOUR = 60 * MIN;

// The Belgrade calendar date of an instant (the server's `outageDate`).
const belgradeDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Belgrade' });

const idOffset = (scenario: Scenario) => 100 * SCENARIOS.indexOf(scenario);

function outage(
  scenario: Scenario,
  sub: SubscriptionDto,
  now: Date,
  startInMs: number,
  durationMs: number,
  extra: Partial<AddressOutageDto> = {},
): AddressOutageDto {
  const start = new Date(Math.round((now.getTime() + startInMs) / MIN) * MIN);
  return {
    id: 1000 + idOffset(scenario) + sub.id,
    subscriptionId: sub.id,
    status: 'active',
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + durationMs).toISOString(),
    outageDate: belgradeDate(start),
    municipality: 'Медијана',
    revision: 0,
    match: 'affected',
    reason: null,
    ...extra,
  };
}

// The extra addresses the "three" scenario adds to whatever the device saved.
const EXTRAS: SubscriptionDto[] = [
  {
    id: 9001,
    streetId: 2,
    settlementId: null,
    name: { latin: 'Studenička', cyrillic: 'Студеничка' },
    houseNumber: 7,
    houseSuffix: null,
    label: 'Roditelji',
    isPrimary: false,
  },
  {
    id: 9002,
    streetId: 4,
    settlementId: null,
    name: { latin: 'Bulevar Nemanjića', cyrillic: 'Булевар Немањића' },
    houseNumber: 12,
    houseSuffix: null,
    label: 'Posao',
    isPrimary: false,
  },
];

/** The addresses the app sees: what the device saved, padded to three in the "three" scenario. */
export function visibleSubscriptions(
  scenario: Scenario,
  mine: SubscriptionDto[],
): SubscriptionDto[] {
  if (scenario !== 'three' || mine.length === 0) return mine;
  return [...mine, ...EXTRAS].slice(0, 3);
}

/** The outages of one address in a scenario. `index` is the address's place in the visible list. */
export function outagesForScenario(
  scenario: Scenario,
  sub: SubscriptionDto,
  index: number,
  now: Date,
): AddressOutageDto[] {
  switch (scenario) {
    case 'clear':
    case 'offline':
      return [];
    case 'imminent':
      return [outage(scenario, sub, now, 2 * HOUR + 20 * MIN, 4 * HOUR)];
    case 'active':
      // started 1 h 48 min ago, so it ends in 1 h 12 min
      return [outage(scenario, sub, now, -(HOUR + 48 * MIN), 3 * HOUR)];
    case 'cancelled':
      return [outage(scenario, sub, now, 3 * HOUR, 4 * HOUR, { status: 'cancelled' })];
    case 'three': {
      if (index === 0) return [outage(scenario, sub, now, -(HOUR + 48 * MIN), 3 * HOUR)];
      if (index === 1) return [outage(scenario, sub, now, 5 * HOUR + 30 * MIN, 4 * HOUR)];
      return [
        outage(scenario, sub, now, 50 * HOUR, 4 * HOUR, { match: 'possible', reason: 'partial' }),
      ];
    }
    case 'possible':
    case 'upcoming':
      // the default: tomorrow, a certain match unless the address has no house number
      return outagesFor(sub, now).map((o) => ({ ...o, id: o.id + idOffset(scenario) }));
  }
}
