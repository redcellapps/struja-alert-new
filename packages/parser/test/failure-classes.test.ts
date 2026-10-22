import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePage, parsePage } from '../src/index.ts';

// Failure classes for later areas (docs/failure-classes.md). Scope is Niš only for now, so these
// are tracked as todos; the data test keeps the real rows honest.
interface Case {
  slot: string;
  file: string;
  ogranak: string | null;
  opstina: string;
  vreme: string;
  ulice: string;
}
const ROOT = new URL('../../../fixtures/', import.meta.url);
const cases: Record<string, Case[]> = JSON.parse(
  readFileSync(new URL('failure-classes/cases.json', ROOT), 'utf8'),
);

describe('failure-class fixtures are real, unmodified EDS rows', () => {
  it('has at least one example of each logged class', () => {
    for (const id of ['except_settlements', 'prefix_ellipsis_list', 'dot_joined_names']) {
      expect(cases[id]?.length, id).toBeGreaterThan(0);
    }
  });
  it('every case is still present, character for character, in the collected page it came from', () => {
    for (const [id, list] of Object.entries(cases)) {
      for (const c of list) {
        const bytes = readFileSync(new URL(`eds/${c.slot}/${c.file}`, ROOT));
        const page = parsePage(decodePage(bytes).text);
        const row = page.rows.find((r) => r.opstina === c.opstina && r.ulice === c.ulice);
        expect(row, `${id}: ${c.file}`).toBeDefined();
      }
    }
  });
  it('the collected snapshots are still there (cases cannot silently lose their source)', () => {
    expect(readdirSync(new URL('eds/', ROOT)).some((d) => d.startsWith('manual-'))).toBe(true);
  });
});

describe('not handled yet: scope is Niš only (docs/failure-classes.md)', () => {
  it.todo(
    '"осим насељених места" is read as an exclusion list: the municipality minus these settlements',
  );
  it.todo('"Доња и Горња Лопушња" expands to the two settlements Доња Лопушња and Горња Лопушња');
  it.todo(
    'a dot between two words without a space ("Облачина.Облачинско језеро") separates two names',
  );
});
