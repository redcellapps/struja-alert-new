import { cyrillicToLatin } from '@struja/parser/transliterate';
import { normalizeName } from '@struja/parser/normalize';
import type { GazetteerResponse } from '@struja/shared';

// Offline street search over the cached gazetteer. Instant and local: `vojvode misica`, `mišića` and
// `војводе` all find "Vojvode Mišića" because the query and the names are normalized the same way
// (parser `normalizeName`, the one the server uses for `name_norm`).

export type PlaceKind = 'street' | 'settlement';

export interface Place {
  kind: PlaceKind;
  id: number;
  nameLatin: string;
  nameCyrillic: string;
  municipality: string | null;
  // The settlement a street is in (Cyrillic): what tells apart streets that share a name.
  settlement: string | null;
  // True when another street has the same name (Војводе Путника in the city and in Трупале).
  repeated: boolean;
  // Normalized names to match against: the name and its alternatives.
  norms: string[];
  // Words of every norm, for prefix matching of each query word.
  words: string[];
}

export interface GazetteerIndex {
  places: Place[];
}

const MAX_RESULTS = 8;

export function buildIndex(g: GazetteerResponse): GazetteerIndex {
  const places: Place[] = [];
  const perName = new Map<string, number>();
  for (const s of g.streets) perName.set(s.nameNorm, (perName.get(s.nameNorm) ?? 0) + 1);
  for (const s of g.streets) {
    const norms = [s.nameNorm, ...s.altNorms];
    places.push({
      kind: 'street',
      id: s.id,
      nameLatin: s.nameLatin ?? cyrillicToLatin(s.nameCyrillic),
      nameCyrillic: s.nameCyrillic,
      municipality: s.municipality,
      settlement: s.settlement,
      repeated: (perName.get(s.nameNorm) ?? 0) > 1,
      norms,
      words: norms.flatMap((n) => n.split(' ')),
    });
  }
  for (const s of g.settlements) {
    const norms = [s.nameNorm, ...s.altNorms];
    places.push({
      kind: 'settlement',
      id: s.id,
      nameLatin: cyrillicToLatin(s.nameCyrillic),
      nameCyrillic: s.nameCyrillic,
      municipality: s.municipality,
      settlement: null,
      repeated: false,
      norms,
      words: norms.flatMap((n) => n.split(' ')),
    });
  }
  return { places };
}

// Lower is better. null: not a match. Every query word must start some word of the name (so a half
// typed last word still matches, and "misica vojvode" finds it too: false positives over misses).
function score(place: Place, query: string, tokens: string[]): number | null {
  if (place.norms.includes(query)) return 0;
  if (place.norms.some((n) => n.startsWith(query))) return 1;
  if (tokens.every((t) => place.words.some((w) => w.startsWith(t)))) return 2;
  if (tokens.every((t) => place.norms.some((n) => n.includes(t)))) return 3;
  return null;
}

export function search(index: GazetteerIndex, input: string, limit = MAX_RESULTS): Place[] {
  const query = normalizeName(input);
  if (query.length < 2) return [];
  const tokens = query.split(' ');
  const scored: { place: Place; s: number }[] = [];
  for (const place of index.places) {
    const s = score(place, query, tokens);
    if (s !== null) scored.push({ place, s });
  }
  scored.sort(
    (a, b) =>
      a.s - b.s ||
      // streets before settlements, then the shorter (closer) name, then alphabetical
      (a.place.kind === b.place.kind ? 0 : a.place.kind === 'street' ? -1 : 1) ||
      a.place.nameLatin.length - b.place.nameLatin.length ||
      a.place.nameLatin.localeCompare(b.place.nameLatin, 'sr-Latn'),
  );
  return scored.slice(0, limit).map((x) => x.place);
}

// The gazetteer of Niš carries the municipality as a key (the parser's lowercase, diacritic-free name):
// these are the names a person knows them by.
const MUNICIPALITY_NAMES: Record<string, { latn: string; cyrl: string }> = {
  palilula: { latn: 'Palilula', cyrl: 'Палилула' },
  medijana: { latn: 'Medijana', cyrl: 'Медијана' },
  pantelej: { latn: 'Pantelej', cyrl: 'Пантелеј' },
  'crveni krst': { latn: 'Crveni krst', cyrl: 'Црвени крст' },
  'niska banja': { latn: 'Niška banja', cyrl: 'Нишка бања' },
};

/** The municipality in the chosen script, by its proper name ("Palilula", not the key "palilula"). */
export const placeMunicipality = (place: Place, script: 'latn' | 'cyrl'): string | null => {
  if (place.municipality === null) return null;
  const known = MUNICIPALITY_NAMES[place.municipality];
  if (known) return known[script];
  return script === 'cyrl' ? place.municipality : cyrillicToLatin(place.municipality);
};

/**
 * The line under a result: the municipality, and for a street whose name repeats the settlement it lies
 * in instead ("Vojvode Putnika · Trupale", "Vojvode Putnika · Palilula"): a village's own name, or
 * the city municipality for a street in the city, so the right one can be picked.
 */
export function placeDetail(place: Place, script: 'latn' | 'cyrl'): string | null {
  const municipality = placeMunicipality(place, script);
  if (place.kind !== 'street' || !place.repeated || !place.settlement) return municipality;
  return script === 'cyrl' ? place.settlement : cyrillicToLatin(place.settlement);
}

/** The street with this id, if the gazetteer has it. */
export function findStreetById(index: GazetteerIndex, id: number): Place | undefined {
  return index.places.find((p) => p.kind === 'street' && p.id === id);
}

/** The street of the gazetteer that goes by this name (any script, case or diacritics), if there is one. */
export function findStreet(index: GazetteerIndex, name: string): Place | undefined {
  const wanted = normalizeName(name);
  return index.places.find((p) => p.kind === 'street' && p.norms.includes(wanted));
}

/** The name in the chosen script. */
export const placeName = (place: Place, script: 'latn' | 'cyrl'): string =>
  script === 'cyrl' ? place.nameCyrillic : place.nameLatin;

export interface HouseNumber {
  houseNumber?: number;
  houseSuffix?: string;
}

/** "34", "34a", "34/1" -> number and suffix; empty input is fine (the number is optional). */
export function parseHouseNumber(input: string): HouseNumber | 'invalid' {
  const text = input.trim();
  if (text === '') return {};
  // A letter suffix may follow the number directly ("34a"); a digit suffix needs a separator ("12/3").
  const m =
    /^(\d{1,4})(?:\s*([A-Za-zČĆŠŽĐčćšžđЀ-ӿ]{1,3})|\s*[/-]\s*([A-Za-zČĆŠŽĐčćšžđЀ-ӿ0-9]{1,3}))?$/.exec(
      text,
    );
  if (!m) return 'invalid';
  const houseNumber = Number(m[1]);
  if (houseNumber < 1 || houseNumber > 9999) return 'invalid';
  const suffix = m[2] ?? m[3];
  return suffix
    ? { houseNumber, houseSuffix: cyrillicToLatin(suffix).toLowerCase() }
    : { houseNumber };
}
