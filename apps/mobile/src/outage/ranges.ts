import { normalizeName } from '@struja/parser/normalize';
import type { OutageDetailDto } from '@struja/shared';
import type { T } from '../home/format';

export type Segment = OutageDetailDto['segments'][number];
export type Range = Segment['ranges'][number];

/** Does the house number fall in the range (bounds inclusive, odd/even respected)? */
export function rangeContains(range: Range, houseNumber: number): boolean {
  if (range.parity === 'odd' && houseNumber % 2 === 0) return false;
  if (range.parity === 'even' && houseNumber % 2 === 1) return false;
  const from = range.from ?? 0;
  const to = range.to ?? Number.POSITIVE_INFINITY;
  return houseNumber >= from && houseNumber <= to;
}

/** "26–40", "neparni 1–41", "parni 2–40", "od 26", "do 40"; `raw` when there is nothing to build from. */
export function rangeLabel(range: Range, t: T): string {
  const parity = range.parity ? `${t(`detail.${range.parity}`)} ` : '';
  if (range.from !== null && range.to !== null) {
    return `${parity}${range.from === range.to ? range.from : `${range.from}–${range.to}`}`;
  }
  if (range.from !== null) return `${parity}${t('detail.from', { n: range.from })}`;
  if (range.to !== null) return `${parity}${t('detail.to', { n: range.to })}`;
  return range.raw;
}

/** The segment of an outage that is about a saved address's street, by normalized name. */
export function segmentForStreet(
  segments: readonly Segment[],
  streetName: { latin: string; cyrillic: string },
): Segment | undefined {
  const wanted = normalizeName(streetName.latin);
  return segments.find(
    (s) => s.kind !== 'unresolved' && s.name !== null && normalizeName(s.name.latin) === wanted,
  );
}

export interface AddressRanges {
  // The street's ranges as chips; the one holding the person's number is marked.
  chips: { label: string; contains: boolean }[];
  // The sentence under them, or null when there is nothing more to say.
  note: string | null;
  // True when the person could settle the doubt by entering a house number.
  askForNumber: boolean;
}

/**
 * What to tell a person about their own address in an outage: the ranges of their street with their
 * number highlighted ("Vaš broj 34 je u opsegu 26–40"), or why we are not sure ("Moguće pogođeno").
 */
export function addressRanges(
  segment: Segment | undefined,
  houseNumber: number | null,
  match: 'affected' | 'possible',
  reason: 'no_number' | 'partial' | 'unresolved' | 'same_name' | null,
  t: T,
): AddressRanges {
  const ranges = segment?.ranges ?? [];
  const chips = ranges.map((r) => ({
    label: rangeLabel(r, t),
    contains: houseNumber !== null && rangeContains(r, houseNumber),
  }));
  if (segment && ranges.length === 0) {
    chips.push({
      label: segment.partial ? t('detail.partOfStreet') : t('detail.wholeStreet'),
      contains: false,
    });
  }
  if (match === 'possible') {
    return {
      chips,
      note:
        reason === 'no_number'
          ? t('detail.possibleNoNumber')
          : reason === 'same_name'
            ? t('detail.possibleSameName')
            : t('status.possible'),
      askForNumber: reason === 'no_number' && houseNumber === null,
    };
  }
  const hit = ranges.find((r) => houseNumber !== null && rangeContains(r, houseNumber));
  const note =
    hit && houseNumber !== null
      ? t('detail.yourNumber', { n: houseNumber, range: rangeLabel(hit, t) })
      : segment && ranges.length === 0 && !segment.partial
        ? t('detail.wholeStreetNote')
        : null;
  return { chips, note, askForNumber: false };
}

/** One line per street of the outage for the "affected streets" list, in the chosen script. */
export function streetLine(
  segment: Segment,
  script: 'latn' | 'cyrl',
  t: T,
): { title: string; detail: string | null } {
  const name = segment.name
    ? script === 'cyrl'
      ? segment.name.cyrillic
      : segment.name.latin
    : segment.raw;
  if (segment.ranges.length > 0) {
    return { title: name, detail: segment.ranges.map((r) => rangeLabel(r, t)).join(', ') };
  }
  if (segment.kind === 'unresolved') return { title: name, detail: null };
  return {
    title: name,
    detail: segment.partial ? t('detail.partOfStreet') : t('detail.wholeStreet'),
  };
}
