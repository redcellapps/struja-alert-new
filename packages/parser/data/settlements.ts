// Settlements EDS names that the OSM snapshots have no place node or boundary for. They join the
// gazetteer's settlement list (packages/parser/src/osm.ts) with a synthetic negative id and no
// coordinates, so a row like "делови Банцарева, ..., Бојаниних вода" resolves every name and a
// person living there can save the place. Reviewed by the owner (30 Oct 2026): these are
// settlement names in the genitive, not streets. When OSM gains the place, the entry can go.
export interface ExtraSettlement {
  name: string;
  kind: string;
  // One of the five municipalities, as normalized by `nisMunicipality` (e.g. "niska banja").
  municipality: string;
  // Other spellings EDS uses, e.g. a genitive plural the case generator does not produce.
  alts?: readonly string[];
}

export const EXTRA_SETTLEMENTS: readonly ExtraSettlement[] = [
  // A locality of Niška Banja (Bojanine vode, a weekend settlement on the Suva planina side).
  {
    name: 'Бојанине воде',
    kind: 'locality',
    municipality: 'niska banja',
    alts: ['Бојаниних вода'], // "делови ... Бојаниних вода" (genitive plural)
  },
];
