// Forward case-form generation. EDS writes street names in running text ("делови Студеничке",
// "Матејевачког пута"), while the gazetteer has nominatives ("Студеничка", "Матејевачки пут").
// Instead of guessing the nominative from a genitive, we generate the genitive, dative/locative,
// accusative and instrumental of every gazetteer name and match against those, which can only
// ever produce real streets. Works on normalized names (Latin, lowercase, no diacritics).
type CaseName = 'gen' | 'dat' | 'acc' | 'ins';
const CASES: readonly CaseName[] = ['gen', 'dat', 'acc', 'ins'];

function tokenForms(t: string): Record<CaseName, string[]> {
  const none = { gen: [t], dat: [t], acc: [t], ins: [t] };
  if (t.length < 3 || /\d/.test(t)) return none;
  const stem = t.slice(0, -1);
  const last = t.slice(-1);
  if (last === 'a') {
    // feminine adjective/noun: studenicka -> studenicke / studenickoj, studenici / studenicku
    return {
      gen: [`${stem}e`],
      dat: [`${stem}oj`, `${stem}i`],
      acc: [`${stem}u`],
      ins: [`${stem}om`],
    };
  }
  if (last === 'i') {
    // masculine adjective: matejevacki -> matejevackog / matejevackom / matejevackim
    return {
      gen: [`${stem}og`, `${stem}oga`],
      dat: [`${stem}om`, `${stem}omu`],
      acc: [t],
      ins: [`${stem}im`],
    };
  }
  if (last === 'e') {
    // neuter noun: naselje -> naselja
    return { gen: [`${stem}a`], dat: [`${stem}u`], acc: [t], ins: [`${stem}em`] };
  }
  if (last === 'o') {
    return { gen: [`${stem}a`], dat: [`${stem}u`], acc: [t], ins: [`${stem}om`] };
  }
  // masculine noun ending in a consonant: put -> puta; -ac drops the fleeting a: gabrovac -> gabrovca
  const base = [t];
  if (t.endsWith('ac') && t.length > 4) base.push(`${t.slice(0, -2)}c`);
  return {
    gen: base.map((b) => (b === t ? `${t}a` : `${b}a`)),
    dat: base.map((b) => (b === t ? `${t}u` : `${b}u`)),
    acc: [...base.map((b) => (b === t ? t : `${b}a`)), `${t}a`],
    ins: base.flatMap((b) => (b === t ? [`${t}om`, `${t}em`] : [`${b}om`, `${b}em`])),
  };
}

const MAX_FORMS = 64;

/**
 * All plausible running-text forms of a normalized street name, including the name itself.
 * Cases are applied consistently across the words of the name ("matejevackog puta").
 */
export function generateForms(nameNorm: string): string[] {
  const out = new Set<string>([nameNorm]);
  const tokens = nameNorm.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const perToken = tokens.map(tokenForms);
  for (const c of CASES) {
    let combos: string[][] = [[]];
    for (const forms of perToken) {
      const next: string[][] = [];
      for (const prefix of combos) {
        for (const f of forms[c]) next.push([...prefix, f]);
      }
      combos = next.slice(0, MAX_FORMS);
    }
    for (const combo of combos) out.add(combo.join(' '));
  }
  return [...out];
}

// Reverse stemming, used only to gather candidates for scoring, never to accept a match.
const ENDINGS = [
  'omu',
  'oga',
  'ome',
  'ima',
  'og',
  'om',
  'oj',
  'im',
  'ih',
  'em',
  'e',
  'u',
  'a',
  'i',
  'o',
];

export function stemToken(t: string): string {
  if (t.length < 4 || /\d/.test(t)) return t;
  for (const e of ENDINGS) {
    if (t.endsWith(e) && t.length - e.length >= 3) return t.slice(0, -e.length);
  }
  return t;
}

export function stems(nameNorm: string): string[] {
  return nameNorm.split(' ').filter(Boolean).map(stemToken);
}
