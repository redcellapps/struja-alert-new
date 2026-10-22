import { isRangePiece, parseRanges, type HouseRange } from './ranges.ts';

export interface Segment {
  // This segment's text exactly as it appeared in the cell (whitespace collapsed only).
  raw: string;
  // Street, village or settlement name with prefixes (делови, део, Ул.) removed.
  name: string;
  // Enclosing `Насеље X` block, when there is one.
  settlement: string | null;
  // `делови X` / `део улице X`: only part of it is affected, which parts is unknown.
  partial: boolean;
  // `Део села X` or `Насеља: X, Y`: a village, not a street.
  village: boolean;
  // Empty = the whole street.
  ranges: HouseRange[];
}

// Split on `sep` outside parentheses.
function splitTop(text: string, sep: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(sep.source, `${sep.flags.replace(/[gy]/g, '')}y`);
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length > 0) {
        out.push(text.slice(start, i));
        i += m[0].length;
        start = i;
        continue;
      }
    }
    i++;
  }
  out.push(text.slice(start));
  return out;
}

const PREFIX = /^(?:делови\s+улица|делови|део\s+улице|део\s+улица|дела|део|улице|улица|ул\.?)\s+/i;
const SETTLEMENT_BLOCK = /^(?:насеље|naselje)\s+(.+?)(?:\s+[-–]\s+|\s*:\s+)(.*)$/i;
const SETTLEMENT_LIST = /^(?:насеља|naselja)\s*:\s*(.*)$/i;
const VILLAGE_PART = /^(?:део\s+села|део\s+насеља)\s+(.*)$/i;

function stripPrefixes(name: string): { name: string; partial: boolean } {
  let partial = false;
  let s = name.trim();
  for (;;) {
    const m = PREFIX.exec(s);
    if (!m) break;
    if (/^(?:делови|део|дела)/i.test(m[0])) partial = true;
    s = s.slice(m[0].length).trim();
  }
  return { name: s, partial };
}

// A trailing "(...)" holds house numbers or parity: "Матејевачког пута (41,бб)".
function takeParens(piece: string): { head: string; inner: string | null } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(piece);
  return m ? { head: (m[1] ?? '').trim(), inner: m[2] ?? '' } : { head: piece.trim(), inner: null };
}

export function splitUlice(cell: string): Segment[] {
  const text = cell.replace(/\s+/g, ' ').trim();
  const out: Segment[] = [];
  for (const chunk of splitTop(text, /;/)) {
    processChunk(chunk.trim().replace(/[.,\s]+$/, ''), out);
  }
  return out;
}

function processChunk(chunk: string, out: Segment[]): void {
  if (!chunk) return;
  const list = SETTLEMENT_LIST.exec(chunk);
  if (list) {
    for (const piece of splitTop(list[1] ?? '', /\s*,\s*|\s+и\s+/)) {
      const name = piece.trim().replace(/[.,]+$/, '');
      if (name)
        out.push({ raw: name, name, settlement: null, partial: false, village: true, ranges: [] });
    }
    return;
  }
  const block = SETTLEMENT_BLOCK.exec(chunk);
  if (block) {
    processItems((block[2] ?? '').trim(), (block[1] ?? '').trim(), out);
    return;
  }
  processItems(chunk, null, out);
}

function processItems(text: string, settlement: string | null, out: Segment[]): void {
  let current: Segment | null = null;
  const firstIndex = out.length;
  let headPartial = false;
  let headVillage = false;
  const pieces = splitTop(text, /\s*,\s*|\s+и\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const piece of pieces) {
    // House numbers continue the street before them: "ГЕЦЕ КОНА: 4-26,1-7А,17".
    if (current && isRangePiece(piece)) {
      current.ranges.push(...parseRanges(piece));
      current.raw += `, ${piece}`;
      continue;
    }
    let body = piece;
    let colonRanges: string | null = null;
    const colon = /^([^:]+?)\s*:\s*(.*)$/.exec(piece);
    if (colon) {
      body = colon[1] ?? '';
      colonRanges = colon[2] ?? '';
    }
    const village = VILLAGE_PART.exec(body);
    const { head, inner } = takeParens(village ? (village[1] ?? '') : body);
    const { name, partial } = stripPrefixes(head);
    if (!name) continue;
    // "делови A и B" / "део села A, B": the head's prefix applies to every item in the chunk.
    if (out.length === firstIndex) {
      headPartial = partial || village !== null;
      headVillage = village !== null;
    }
    const seg: Segment = {
      raw: piece,
      name,
      settlement,
      partial: partial || village !== null || headPartial,
      village: village !== null || headVillage,
      ranges: [],
    };
    if (inner !== null) seg.ranges.push(...parseRanges(inner));
    if (colonRanges) seg.ranges.push(...parseRanges(colonRanges));
    out.push(seg);
    current = seg;
  }
}
