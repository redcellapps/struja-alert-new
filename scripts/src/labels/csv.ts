// Minimal CSV reader/writer for fixtures/labels.csv (quoted fields, doubled quotes, embedded newlines).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvCell(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export interface Reviewed {
  confirmed: string;
  notes: string;
}

// Rows are identified the same way the builder keys them: municipality + raw segment.
export function labelKey(opstina: string, rawSegment: string): string {
  return `${opstina}|${rawSegment}`;
}

/** The reviewer's `confirmed`/`notes` from an existing labels.csv, by row key. */
export function readReviewed(csvText: string): Map<string, Reviewed> {
  const [head, ...rows] = parseCsv(csvText);
  const out = new Map<string, Reviewed>();
  if (!head) return out;
  const col = (name: string) => head.indexOf(name);
  const [iOp, iRaw, iConf, iNotes] = [
    col('opstina'),
    col('raw_segment'),
    col('confirmed'),
    col('notes'),
  ];
  if (iOp < 0 || iRaw < 0 || iConf < 0) return out;
  for (const r of rows) {
    const confirmed = r[iConf] ?? '';
    const notes = iNotes >= 0 ? (r[iNotes] ?? '') : '';
    if (confirmed !== '' || notes !== '') {
      out.set(labelKey(r[iOp] ?? '', r[iRaw] ?? ''), { confirmed, notes });
    }
  }
  return out;
}
