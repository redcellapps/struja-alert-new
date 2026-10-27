import { latinToCyrillic } from '@struja/parser/transliterate';

// sr-Cyrl is generated from the sr-Latn source, string by string, with the parser's transliteration.
// {{placeholders}} are left alone. `CYRL_OVERRIDES` (dotted key -> text) fixes the few strings where
// the mechanical result is wrong, e.g. a word with a Latin "nj" that is two letters in Cyrillic.
export const CYRL_OVERRIDES: Record<string, string> = {};

// Left as they are: {{placeholders}} and the names of the map data and the tile host (and "IP", "©").
const PLACEHOLDER = /(\{\{[^}]+\}\}|OpenStreetMap|OpenMapTiles|OpenFreeMap|contributors|\bIP\b|©)/;

export function transliterate(text: string): string {
  return text
    .split(PLACEHOLDER)
    .map((part) => (PLACEHOLDER.test(part) ? part : latinToCyrillic(part)))
    .join('');
}

export type Tree = { [key: string]: string | Tree };

export function toCyrillic(tree: Tree, overrides = CYRL_OVERRIDES, path = ''): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(tree)) {
    const dotted = path ? `${path}.${key}` : key;
    out[key] =
      typeof value === 'string'
        ? (overrides[dotted] ?? transliterate(value))
        : toCyrillic(value, overrides, dotted);
  }
  return out;
}
