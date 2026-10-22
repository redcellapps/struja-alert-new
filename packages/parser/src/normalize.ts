import { ABBREVIATIONS } from '../data/abbreviations.ts';
import { cyrillicToLatin } from './transliterate.ts';

function stripDiacritics(text: string): string {
  return text
    .replaceAll('đ', 'dj')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
}

function expandToken(token: string): string {
  const exact = ABBREVIATIONS[token];
  if (exact !== undefined) return exact;
  if (token.endsWith('.')) {
    const bare = token.replace(/\.+$/, '');
    // Only dot-less keys (like `dr`) match their dotted form.
    if (!(`${bare}.` in ABBREVIATIONS)) {
      const viaBare = ABBREVIATIONS[bare];
      if (viaBare !== undefined) return viaBare;
    }
  }
  return token;
}

/**
 * `name_norm` (BRIEF §3), steps in this exact order:
 * Cyrillic -> Latin, lowercase, strip diacritics, expand abbreviations, drop a leading
 * `ulica`, collapse whitespace/punctuation. `ВОЈВОДЕ МИШИЋА` -> `vojvode misica`.
 */
export function normalizeName(input: string): string {
  const lowered = cyrillicToLatin(input).toLowerCase();
  const plain = stripDiacritics(lowered);
  const expanded = plain.split(/\s+/).filter(Boolean).map(expandToken).join(' ');
  const collapsed = expanded
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (collapsed[0] === 'ulica') collapsed.shift();
  return collapsed.join(' ');
}
