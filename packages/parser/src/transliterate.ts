// Serbian Cyrillic -> Latin. Latin and other characters pass through unchanged.
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['а', 'a'],
  ['б', 'b'],
  ['в', 'v'],
  ['г', 'g'],
  ['д', 'd'],
  ['ђ', 'đ'],
  ['е', 'e'],
  ['ж', 'ž'],
  ['з', 'z'],
  ['и', 'i'],
  ['ј', 'j'],
  ['к', 'k'],
  ['л', 'l'],
  ['љ', 'lj'],
  ['м', 'm'],
  ['н', 'n'],
  ['њ', 'nj'],
  ['о', 'o'],
  ['п', 'p'],
  ['р', 'r'],
  ['с', 's'],
  ['т', 't'],
  ['ћ', 'ć'],
  ['у', 'u'],
  ['ф', 'f'],
  ['х', 'h'],
  ['ц', 'c'],
  ['ч', 'č'],
  ['џ', 'dž'],
  ['ш', 'š'],
];

const MAP = new Map<string, string>();
for (const [cyr, lat] of PAIRS) {
  MAP.set(cyr, lat);
  MAP.set(cyr.toUpperCase(), lat.charAt(0).toUpperCase() + lat.slice(1));
}

export function cyrillicToLatin(text: string): string {
  let out = '';
  for (const ch of text) out += MAP.get(ch) ?? ch;
  return out;
}

// Latin -> Serbian Cyrillic, for generating sr-Cyrl copy from the sr-Latn source (BRIEF §6).
// lj, nj and dž are single letters (љ, њ, џ). "dj" is NOT treated as ђ (that is written đ), so
// words where lj/nj/dž are two letters ("konjunkcija", "injekcija") need an override.
const LATIN_DIGRAPHS: ReadonlyArray<readonly [string, string]> = [
  ['lj', 'љ'],
  ['nj', 'њ'],
  ['dž', 'џ'],
];
const LATIN_LETTERS = new Map<string, string>();
for (const [cyr, lat] of PAIRS) {
  if (lat.length === 1) LATIN_LETTERS.set(lat, cyr);
}
LATIN_LETTERS.set('đ', 'ђ');

function mapLatinWord(word: string): string {
  let out = '';
  for (let i = 0; i < word.length;) {
    const lower = word.slice(i, i + 2).toLowerCase();
    const digraph = LATIN_DIGRAPHS.find(([lat]) => lat === lower);
    if (digraph) {
      const cyr = digraph[1];
      // "Lj" and "LJ" are both the capital Љ; "lJ" is treated as lowercase.
      out +=
        word.charAt(i) === word.charAt(i).toUpperCase() &&
        word.charAt(i) !== word.charAt(i).toLowerCase()
          ? cyr.toUpperCase()
          : cyr;
      i += 2;
      continue;
    }
    const ch = word.charAt(i);
    const mapped = LATIN_LETTERS.get(ch.toLowerCase());
    if (mapped === undefined) out += ch;
    else out += ch === ch.toLowerCase() ? mapped : mapped.toUpperCase();
    i++;
  }
  return out;
}

/**
 * `overrides` maps whole Latin words (exact match, lowercase) to their Cyrillic spelling, for the
 * rare words the letter rules get wrong.
 */
export function latinToCyrillic(
  text: string,
  overrides: Readonly<Record<string, string>> = {},
): string {
  return text.replace(/[\p{L}]+/gu, (word) => {
    const o = overrides[word.toLowerCase()];
    if (o !== undefined) {
      // keep a leading capital
      return word.charAt(0) !== word.charAt(0).toLowerCase()
        ? o.charAt(0).toUpperCase() + o.slice(1)
        : o;
    }
    return mapLatinWord(word);
  });
}
