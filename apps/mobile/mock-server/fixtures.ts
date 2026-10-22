import type {
  AddressOutageDto,
  CitiesResponse,
  GazetteerResponse,
  OutageDetailDto,
  SubscriptionDto,
} from '@struja/shared';

// Typed fixtures for the mock API that development and the Maestro/QA runs use. The types come from
// the shared zod schemas, so a contract change breaks this file at typecheck time. Times are built
// relative to "now" so the screens always show a believable day.

export const cities: CitiesResponse = {
  cities: [
    { id: 'nis', name: 'Niš', active: true, gazetteerVersion: 1 },
    { id: 'beograd', name: 'Beograd', active: false, gazetteerVersion: null },
    { id: 'novi-sad', name: 'Novi Sad', active: false, gazetteerVersion: null },
  ],
};

const street = (id: number, cyr: string, lat: string, norm: string, municipality: string) => ({
  id,
  nameCyrillic: cyr,
  nameLatin: lat,
  nameNorm: norm,
  altNorms: [],
  municipality,
});

export const gazetteer: GazetteerResponse = {
  city: 'nis',
  version: 1,
  etag: '"mock-1"',
  streets: [
    street(1, 'Војводе Мишића', 'Vojvode Mišića', 'vojvode misica', 'Медијана'),
    street(2, 'Студеничка', 'Studenička', 'studenicka', 'Пантелеј'),
    street(3, 'Космајска', 'Kosmajska', 'kosmajska', 'Палилула - Ниш'),
    street(4, 'Булевар Немањића', 'Bulevar Nemanjića', 'bulevar nemanjica', 'Медијана'),
    street(5, 'Чегарска', 'Čegarska', 'cegarska', 'Црвени крст'),
  ],
  settlements: [
    {
      id: 1,
      nameCyrillic: 'Бубањ',
      nameNorm: 'bubanj',
      altNorms: [],
      kind: 'village',
      municipality: 'Црвени крст',
    },
  ],
};

const HOUR = 3600_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function outagesFor(subscription: SubscriptionDto, now: Date): AddressOutageDto[] {
  const start = new Date(now.getTime() + 26 * HOUR);
  start.setUTCMinutes(0, 0, 0);
  return [
    {
      id: 1000 + subscription.id,
      subscriptionId: subscription.id,
      status: 'active',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 4 * HOUR).toISOString(),
      outageDate: isoDate(start),
      municipality: 'Медијана',
      revision: 0,
      match: subscription.houseNumber ? 'affected' : 'possible',
      reason: subscription.houseNumber ? null : 'no_number',
    },
  ];
}

export function detailFor(id: number, subscriptionId: number, now: Date): OutageDetailDto {
  const start = new Date(now.getTime() + 26 * HOUR);
  start.setUTCMinutes(0, 0, 0);
  return {
    id,
    city: 'nis',
    municipality: 'Медијана',
    outageDate: isoDate(start),
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 4 * HOUR).toISOString(),
    status: 'active',
    revision: 0,
    rawStreets: 'Војводе Мишића (непарни од 1 до 41), делови Студеничке;',
    segments: [
      {
        raw: 'Војводе Мишића (непарни од 1 до 41)',
        kind: 'street',
        name: { latin: 'Vojvode Mišića', cyrillic: 'Војводе Мишића' },
        partial: false,
        ranges: [{ raw: 'непарни од 1 до 41', from: 1, to: 41, parity: 'odd' }],
      },
      {
        raw: 'делови Студеничке',
        kind: 'street',
        name: { latin: 'Studenička', cyrillic: 'Студеничка' },
        partial: true,
        ranges: [],
      },
    ],
    geometry: { type: 'FeatureCollection', features: [] },
    source: {
      name: 'Elektrodistribucija Srbije',
      url: 'https://elektrodistribucija.rs/planirana-iskljucenja/planirana-ni',
    },
    mine: [{ subscriptionId, match: 'affected', reason: null }],
  };
}
