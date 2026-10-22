export const PARSER_VERSION = '0.0.0';
export { cyrillicToLatin } from './transliterate.ts';
export { normalizeName } from './normalize.ts';
export { decodePage, decodeWindows1251, type Encoding } from './decode.ts';
export {
  belgradeLocalToUtc,
  belgradeOffsetMinutes,
  parsePageDate,
  parseTimeWindow,
  type PageDate,
} from './time.ts';
export { parsePage, type PageRow, type ParsedPage } from './page.ts';
export { parseRanges, parseRangePiece, type HouseRange, type Parity } from './ranges.ts';
export { splitUlice, type Segment } from './split.ts';
export { generateForms, stemToken, stems } from './forms.ts';
export {
  StreetIndex,
  type Candidate,
  type GazStreet,
  type Resolution,
  type ResolvedBy,
} from './gazetteer.ts';
export {
  buildNisGazetteer,
  nisMunicipality,
  NIS_MUNICIPALITY_KEYS,
  type MunicipalitySnapshot,
  type NisGazetteer,
  type NisMunicipality,
  type NisSettlement,
  type NisStreet,
  type OsmPlace,
  type OsmStreetWay,
} from './osm.ts';
