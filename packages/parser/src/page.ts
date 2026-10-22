import { DomUtils, parseDocument } from 'htmlparser2';
import { parsePageDate, parseTimeWindow, type PageDate } from './time.ts';

export interface PageRow {
  // Branch (Огранак). Absent on Belgrade pages.
  ogranak: string | null;
  opstina: string;
  vreme: string;
  // The Ulice cell exactly as published, only trimmed. Always kept.
  ulice: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface ParsedPage {
  title: string;
  date: PageDate | null;
  rows: PageRow[];
  // An outage table with the Улице header was found. A page with the header and no rows is valid
  // data ("no outages"); a page with no table at all is not.
  tableFound: boolean;
}

/**
 * EDS pages end with the closing html tag. A page cut off in the middle (a truncated download that
 * still came back with HTTP 200) does not, and its last rows may be garbled.
 */
export function isCompletePage(html: string): boolean {
  return /<\/html\s*>\s*$/i.test(html.trimEnd());
}

const text = (node: Parameters<typeof DomUtils.textContent>[0]) =>
  DomUtils.textContent(node).replaceAll(String.fromCharCode(0xa0), ' ').trim();

export function parsePage(html: string): ParsedPage {
  const doc = parseDocument(html);
  const trs = DomUtils.findAll((el) => el.name === 'tr', doc.children);
  let title = '';
  let cols: { ogranak: number; opstina: number; vreme: number; ulice: number } | null = null;
  const rows: PageRow[] = [];
  let date: PageDate | null = null;

  const firstTable = DomUtils.findOne((el) => el.name === 'table', doc.children);
  if (firstTable) {
    title = text(firstTable);
    date = parsePageDate(title);
  }

  for (const tr of trs) {
    const cells = DomUtils.findAll(
      (el) => el.name === 'td' || el.name === 'th',
      tr.children,
    ).filter((c) => c.parent === tr);
    const values = cells.map((c) => text(c));
    // The header row names the columns; Belgrade omits Огранак.
    const ulice = values.findIndex((v) => /^(улице|ulice)$/i.test(v));
    if (ulice >= 0) {
      cols = {
        ogranak: values.findIndex((v) => /^(огранак|ogranak)$/i.test(v)),
        opstina: values.findIndex((v) => /^(општина|opština|opstina)$/i.test(v)),
        vreme: values.findIndex((v) => /^(време|vreme)$/i.test(v)),
        ulice,
      };
      continue;
    }
    if (!cols || values.length <= cols.ulice || cols.vreme < 0) continue;
    const vreme = values[cols.vreme] ?? '';
    const window = date ? parseTimeWindow(vreme, date) : null;
    rows.push({
      ogranak: cols.ogranak >= 0 ? (values[cols.ogranak] ?? null) : null,
      opstina: cols.opstina >= 0 ? (values[cols.opstina] ?? '') : '',
      vreme,
      ulice: values[cols.ulice] ?? '',
      startsAt: window?.startsAt ?? null,
      endsAt: window?.endsAt ?? null,
    });
  }
  return { title, date, rows, tableFound: cols !== null };
}
