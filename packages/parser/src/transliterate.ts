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
