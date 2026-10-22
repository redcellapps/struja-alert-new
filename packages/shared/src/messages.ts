import { latinToCyrillic } from '@struja/parser/transliterate';
import { belgradeLocal } from '@struja/parser/time';

// Notification copy (BRIEF §5). Serbian ekavica; sr-Latn is the source of truth and sr-Cyrl is
// generated from it with the parser's transliteration (plus a small override map). Street names
// are not transliterated: the Cyrillic form comes from the gazetteer.
export type NotificationKind = 'new' | 'evening_before' | 'changed' | 'cancelled' | 'reinstated';
export type Script = 'latn' | 'cyrl';
export type Locale = 'sr' | 'en';

// Why a match is only "possibly affected".
export type PossibleReason = 'no_number' | 'partial' | 'unresolved';

export interface TimeWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface MessageInput {
  kind: NotificationKind;
  // Display name of the street and the house number the user saved ("" when none).
  street: { latin: string; cyrillic: string };
  houseNumber?: string;
  window: TimeWindow;
  // Further windows when one "Izmena" lists several new times (ambiguous change).
  moreWindows?: TimeWindow[];
  // When the message is sent: decides "danas" / "sutra" / weekday.
  now: Date;
  possible?: PossibleReason | null;
}

export interface Message {
  title: string;
  body: string;
}

// Words the letter rules would get wrong (lj/nj/dž that are two letters). Add as they appear.
export const CYRL_OVERRIDES: Readonly<Record<string, string>> = {};

const DAYS_SR = ['nedelja', 'ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const hhmm = (d: Date) => {
  const l = belgradeLocal(d);
  return `${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`;
};
const range = (w: TimeWindow) => `${hhmm(w.startsAt)}–${hhmm(w.endsAt)}`;

function dayLabel(startsAt: Date, now: Date, locale: Locale): string {
  const day = belgradeLocal(startsAt);
  const today = belgradeLocal(now);
  const tomorrow = belgradeLocal(new Date(now.getTime() + 24 * 3600_000));
  if (day.date === today.date) return locale === 'en' ? 'today' : 'danas';
  if (day.date === tomorrow.date) return locale === 'en' ? 'tomorrow' : 'sutra';
  const name = (locale === 'en' ? DAYS_EN : DAYS_SR)[day.weekday] ?? '';
  return `${name} ${day.day}.${day.month}.`;
}

const REASON_SR: Record<PossibleReason, string> = {
  no_number: 'Niste uneli kućni broj, pa nije sigurno da ste pogođeni.',
  partial: 'Isključenje se odnosi na delove ulice.',
  unresolved: 'Ulica iz obaveštenja nije sa sigurnošću prepoznata.',
};
const REASON_EN: Record<PossibleReason, string> = {
  no_number: 'You did not enter a house number, so it is not certain you are affected.',
  partial: 'The outage covers parts of the street.',
  unresolved: 'The street in the notice could not be identified with certainty.',
};

// Templates use {0}.. placeholders (not words) so transliteration cannot touch them:
// {0} street (+ number), {1} day, {2} time window, {3} the new windows (changed).
interface Templates {
  new: string;
  evening_before: string;
  changed: string;
  changedMany: string;
  cancelled: string;
  reinstated: string;
  newPossible: string;
  eveningPossible: string;
  changedPossible: string;
  changedManyPossible: string;
  moreWindows: string;
  source: string;
  possibleLabel: string;
}

const SR: Templates = {
  new: 'Isključenje struje: {0}, {1} {2}',
  evening_before: 'Sutra bez struje: {0}, {2}',
  changed: 'Izmena: {0}, novo vreme {2}',
  changedMany: 'Izmena: {0}, nova vremena {3}',
  cancelled: 'Otkazano: isključenje {1}, {0}',
  reinstated: 'Isključenje ipak važi: {0}, {1} {2}',
  newPossible: 'Moguće pogođeno: {0}, {1} {2}',
  eveningPossible: 'Sutra moguće bez struje: {0}, {2}',
  changedPossible: 'Izmena (moguće pogođeno): {0}, novo vreme {2}',
  changedManyPossible: 'Izmena (moguće pogođeno): {0}, nova vremena {3}',
  moreWindows: '{0}',
  source: 'Izvor: Elektrodistribucija Srbije.',
  possibleLabel: 'Moguće pogođeno.',
};

const EN: Templates = {
  new: 'Power outage: {0}, {1} {2}',
  evening_before: 'Tomorrow without power: {0}, {2}',
  changed: 'Update: {0}, new time {2}',
  changedMany: 'Update: {0}, new times {3}',
  cancelled: 'Cancelled: outage {1}, {0}',
  reinstated: 'Outage reinstated: {0}, {1} {2}',
  newPossible: 'Possibly affected: {0}, {1} {2}',
  eveningPossible: 'Tomorrow possibly without power: {0}, {2}',
  changedPossible: 'Update (possibly affected): {0}, new time {2}',
  changedManyPossible: 'Update (possibly affected): {0}, new times {3}',
  moreWindows: '{0}',
  source: 'Source: Elektrodistribucija Srbije.',
  possibleLabel: 'Possibly affected.',
};

const fill = (tpl: string, vars: string[]) =>
  tpl.replace(/\{(\d)\}/g, (_, i) => vars[Number(i)] ?? '');

export function renderMessage(
  input: MessageInput,
  opts: { script: Script; locale: Locale },
): Message {
  const { locale, script } = opts;
  const T = locale === 'en' ? EN : SR;
  const cyr = locale === 'sr' && script === 'cyrl';
  // Serbian copy is written in Latin and transliterated; English stays as is.
  const tr = (s: string) => (cyr ? latinToCyrillic(s, CYRL_OVERRIDES) : s);

  const street = `${cyr || (locale === 'en' && script === 'cyrl') ? input.street.cyrillic : input.street.latin}${
    input.houseNumber ? ` ${input.houseNumber}` : ''
  }`;
  const day = tr(dayLabel(input.window.startsAt, input.now, locale));
  const windows = [input.window, ...(input.moreWindows ?? [])].map(range);
  const many = windows.length > 1;
  const possible = input.possible ?? null;

  let tpl: string;
  switch (input.kind) {
    case 'new':
      tpl = possible ? T.newPossible : T.new;
      break;
    case 'evening_before':
      tpl = possible ? T.eveningPossible : T.evening_before;
      break;
    case 'changed':
      tpl = many
        ? possible
          ? T.changedManyPossible
          : T.changedMany
        : possible
          ? T.changedPossible
          : T.changed;
      break;
    case 'cancelled':
      tpl = T.cancelled;
      break;
    case 'reinstated':
      tpl = T.reinstated;
      break;
  }
  const title = fill(tr(tpl), [street, day, windows[0] ?? '', windows.join(', ')]);

  const reason = possible ? (locale === 'en' ? REASON_EN : REASON_SR)[possible] : '';
  const parts = possible ? [T.possibleLabel, reason, T.source] : [T.source];
  const body = tr(parts.join(' '));
  return { title, body };
}
