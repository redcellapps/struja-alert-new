import { MOCK_GEOMETRY } from './geometry.ts';
import type { AddressOutageDto, OutageDetailDto, SubscriptionDto } from '@struja/shared';
import { cyrillicToLatin } from '@struja/parser/transliterate';
import { detailForOutage, outagesFor } from './fixtures.ts';

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
  'fail',
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
    case 'fail':
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

// ---- the city-wide list (Najave) and the history (Istorija)

export interface CityOutage {
  id: number;
  municipality: string;
  startsAt: string;
  endsAt: string;
  outageDate: string;
  status: 'active' | 'changed' | 'cancelled';
  streets: string[];
}

// The instant of a Belgrade wall-clock time ("08:30" on 2026-11-04), whatever the offset that day.
function belgrade(date: string, time: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const local = Date.parse(
    new Date(asUtc).toLocaleString('sv-SE', { timeZone: 'Europe/Belgrade' }).replace(' ', 'T') +
      'Z',
  );
  return new Date(asUtc - (local - asUtc));
}
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * 24 * HOUR).toISOString().slice(0, 10);

/** Everything announced for the city that is not over yet: the person's own outages plus others. */
export function cityOutages(scenario: Scenario, mine: AddressOutageDto[], now: Date): CityOutage[] {
  if (scenario === 'clear') return [];
  const today = belgradeDate(now);
  const others: [number, number, string, string, string, string[], CityOutage['status']?][] = [
    [2001, 0, '17:30', '21:30', 'Медијана', ['Војводе Мишића', 'Студеничка'], undefined],
    [
      2002,
      1,
      '08:30',
      '12:30',
      'Пантелеј',
      ['Булевар Немањића', 'Космајска', 'Чегарска'],
      undefined,
    ],
    [2003, 1, '13:00', '16:00', 'Црвени крст', ['Чегарска', 'Нишка бања'], undefined],
    [2004, 1, '18:00', '20:00', 'Медијана', ['Булевар Немањића'], 'cancelled'],
    [
      2005,
      2,
      '09:00',
      '15:00',
      'Палилула - Ниш',
      ['Космајска', 'Бубањ', 'Шумадијска', 'Ратка Павловића', 'Трг краља Милана'],
      undefined,
    ],
    [2006, 3, '07:30', '11:30', 'Нишка Бања', ['Студеничка'], 'changed'],
  ];
  const list: CityOutage[] = [
    ...mine.map((o) => ({
      id: o.id,
      municipality: o.municipality,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      outageDate: o.outageDate,
      status: o.status,
      streets: ['Војводе Мишића', 'Булевар Немањића', 'Студеничка'],
    })),
    ...others.map(([id, day, from, to, municipality, streets, status]) => {
      const date = addDays(today, day);
      return {
        id,
        municipality,
        startsAt: belgrade(date, from).toISOString(),
        endsAt: belgrade(date, to).toISOString(),
        outageDate: date,
        status: status ?? ('active' as const),
        streets,
      };
    }),
  ];
  return list
    .filter((o) => Date.parse(o.endsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** The outages of the person's addresses that are over (a new person, "clear", has none). */
export function historyOutages(
  scenario: Scenario,
  subs: SubscriptionDto[],
  now: Date,
): AddressOutageDto[] {
  if (scenario === 'clear') return [];
  const past: [number, number, boolean][] = [
    [-2, 3, false],
    [-9, 4, false],
    [-19, 3, true],
    [-41, 5, false],
    [-77, 4, false],
    [-130, 3, false],
  ];
  return subs.flatMap((sub) =>
    past.map(([days, hours, cancelled], k) => {
      const start = new Date(Math.round((now.getTime() + days * 24 * HOUR) / MIN) * MIN);
      return {
        id: 3000 + sub.id * 10 + k,
        subscriptionId: sub.id,
        status: cancelled ? ('cancelled' as const) : ('active' as const),
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + hours * HOUR).toISOString(),
        outageDate: belgradeDate(start),
        municipality: 'Медијана',
        revision: 0,
        match: 'affected' as const,
        reason: null,
      };
    }),
  );
}

/** The detail of a city outage (someone else's outage: it does not concern the person). */
function detailForCity(o: CityOutage): OutageDetailDto {
  return {
    id: o.id,
    city: 'nis',
    municipality: o.municipality,
    outageDate: o.outageDate,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    status: o.status,
    revision: o.status === 'changed' ? 1 : 0,
    rawStreets: o.streets.join(', ') + ';',
    segments: o.streets.map((raw) => ({
      raw,
      kind: 'street' as const,
      name: { latin: cyrillicToLatin(raw), cyrillic: raw },
      partial: false,
      ranges: [],
    })),
    geometry: MOCK_GEOMETRY,
    source: {
      name: 'Elektrodistribucija Srbije',
      url: 'https://elektrodistribucija.rs/planirana-iskljucenja/planirana-ni',
    },
    mine: [],
  };
}

/** The detail of any outage the mock lists: the person's own, an old one, or somebody else's. */
export function findDetail(
  scenario: Scenario,
  visible: SubscriptionDto[],
  now: Date,
  id: number,
): OutageDetailDto | undefined {
  const mine = visible.flatMap((s, i) => outagesForScenario(scenario, s, i, now));
  const own = [...mine, ...historyOutages(scenario, visible, now)].find((o) => o.id === id);
  if (own) return detailForOutage(own);
  const city = cityOutages(scenario, mine, now).find((o) => o.id === id);
  return city ? detailForCity(city) : undefined;
}
