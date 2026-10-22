// Numbers written as words versus digits (BRIEF §3 step 4): "дванаестог фебруара" vs
// "12. фебруар", "прилаз два" vs "прилаз 2". Both sides are canonicalized to digits before they
// are compared; a match this way is only accepted when exactly one street results.
// Works on normalized names (Latin, lowercase, no diacritics).
const CARDINALS: Record<string, number> = {
  jedan: 1,
  jedna: 1,
  jedno: 1,
  dva: 2,
  dve: 2,
  dvije: 2,
  tri: 3,
  cetiri: 4,
  pet: 5,
  sest: 6,
  sedam: 7,
  osam: 8,
  devet: 9,
  deset: 10,
  jedanaest: 11,
  dvanaest: 12,
  trinaest: 13,
  cetrnaest: 14,
  petnaest: 15,
  sesnaest: 16,
  sedamnaest: 17,
  osamnaest: 18,
  devetnaest: 19,
  dvadeset: 20,
};

// Ordinal stems (prv-i, drug-a, dvanaest-og, ...).
const ORDINAL_STEMS: Record<string, number> = {
  prv: 1,
  drug: 2,
  trec: 3,
  cetvrt: 4,
  pet: 5,
  sest: 6,
  sedm: 7,
  osm: 8,
  devet: 9,
  deset: 10,
  jedanaest: 11,
  dvanaest: 12,
  trinaest: 13,
  cetrnaest: 14,
  petnaest: 15,
  sesnaest: 16,
  sedamnaest: 17,
  osamnaest: 18,
  devetnaest: 19,
  dvadeset: 20,
};
const ORDINAL_ENDINGS = ['i', 'a', 'o', 'og', 'e', 'oj', 'om', 'u', 'im', 'ih'];

const WORD_TO_NUMBER = new Map<string, number>(Object.entries(CARDINALS));
for (const [stem, n] of Object.entries(ORDINAL_STEMS)) {
  for (const end of ORDINAL_ENDINGS) {
    // "trec" + "e" is also the neuter/genitive "trece"; first writer wins on collisions.
    if (!WORD_TO_NUMBER.has(stem + end)) WORD_TO_NUMBER.set(stem + end, n);
  }
}

export function canonicalizeNumbers(nameNorm: string): string {
  return nameNorm
    .split(' ')
    .map((t) => {
      const n = WORD_TO_NUMBER.get(t);
      return n === undefined ? t : String(n);
    })
    .join(' ');
}
