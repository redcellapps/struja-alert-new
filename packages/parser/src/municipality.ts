import { normalizeName } from './normalize.ts';

export const NIS_MUNICIPALITY_KEYS = [
  'medijana',
  'palilula',
  'pantelej',
  'crveni krst',
  'niska banja',
] as const;
export type NisMunicipality = (typeof NIS_MUNICIPALITY_KEYS)[number];

/**
 * Maps a municipality name, as EDS writes it ("Палилула - Ниш", "Нишка бања") or as OSM names it
 * ("Gradska opština Palilula"), to one of the five Niš city municipalities, else null.
 */
export function nisMunicipality(name: string): NisMunicipality | null {
  const n = normalizeName(name)
    .replace(/^gradska opstina /, '')
    .replace(/ nis$/, '')
    .trim();
  return (NIS_MUNICIPALITY_KEYS as readonly string[]).includes(n) ? (n as NisMunicipality) : null;
}
