export type Parity = 'odd' | 'even';

export interface HouseRange {
  // null from/to with `bb` = a house without a number (бб); null with parity only = every
  // odd/even number on the street.
  from: number | null;
  to: number | null;
  fromSuffix: string | null;
  toSuffix: string | null;
  parity: Parity | null;
  bb: boolean;
  raw: string;
}

const LETTER = '[A-Za-zА-Яа-яЂЈЉЊЋЏђјљњћџ]';
const NUMBER = new RegExp(`^(\\d+)(${LETTER})?(?:\\s*[-–]\\s*(\\d+)(${LETTER})?)?$`);
const BB = /^(?:бб|bb|б\.\s?б\.?|b\.\s?b\.?)$/i;
// No `\b`: JavaScript word boundaries ignore Cyrillic letters.
const PARITY =
  /^(непарни|непарне|непарних|neparni|neparne|парни|парне|парних|parni|parne)(?=\s|\.|$)/i;
// Leading "бр." (broj) before the numbers.
const BR = /^(?:бр\.?|br\.?)(?=\s|\d|$)\s*/i;

function parityOf(word: string): Parity {
  return /^не|^ne/i.test(word) ? 'odd' : 'even';
}

export function parseRangePiece(piece: string): HouseRange | null {
  let s = piece
    .trim()
    .replace(/[.;]+$/, '')
    .trim();
  if (!s) return null;
  let parity: Parity | null = null;
  const p = PARITY.exec(s);
  if (p?.[1]) {
    parity = parityOf(p[1]);
    s = s.slice(p[0].length).replace(/^\s*/, '').replace(BR, '').trim();
  } else {
    s = s.replace(BR, '').trim();
  }
  const raw = piece.trim();
  if (s === '') {
    return parity
      ? { from: null, to: null, fromSuffix: null, toSuffix: null, parity, bb: false, raw }
      : null;
  }
  if (BB.test(s)) {
    return { from: null, to: null, fromSuffix: null, toSuffix: null, parity, bb: true, raw };
  }
  const m = NUMBER.exec(s);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[3] !== undefined ? Number(m[3]) : from;
  return {
    from,
    to,
    fromSuffix: m[2] ?? null,
    toSuffix: m[3] !== undefined ? (m[4] ?? null) : (m[2] ?? null),
    parity,
    bb: false,
    raw,
  };
}

export function isRangePiece(piece: string): boolean {
  return parseRangePiece(piece) !== null;
}

// "9-53, парни бр. 30-44" -> ranges. Commas and " и " separate pieces.
export function parseRanges(text: string): HouseRange[] {
  const out: HouseRange[] = [];
  for (const piece of text.split(/\s*,\s*|\s+и\s+/)) {
    const r = parseRangePiece(piece);
    if (r) out.push(r);
  }
  return out;
}
