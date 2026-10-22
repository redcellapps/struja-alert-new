// Abbreviation expansions applied to normalized (Latin, lowercase, no diacritics) tokens.
// Keys are matched exactly, so `nas.` expands but the pronoun `nas` does not. A key without a
// trailing dot (`dr`) also matches its dotted form (`dr.`). An empty value drops the token.
// Add entries here as new abbreviations show up in the corpus.
export const ABBREVIATIONS: Readonly<Record<string, string>> = {
  'bul.': 'bulevar',
  'ul.': '',
  'br.': '',
  'nas.': 'naselje',
  'gen.': 'general',
  dr: 'doktor',
  'sv.': 'sveti',
};
