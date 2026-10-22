import { z } from 'zod';

export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof errorSchema>;

export const citySchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  // Present for active cities: the app caches the gazetteer by this version / ETag.
  gazetteerVersion: z.number().int().nullable(),
});
export const citiesResponseSchema = z.object({ cities: z.array(citySchema) });
export type CitiesResponse = z.infer<typeof citiesResponseSchema>;

// Everything the app needs to search streets offline (script- and diacritic-insensitive).
export const gazetteerStreetSchema = z.object({
  id: z.number().int(),
  nameCyrillic: z.string(),
  nameLatin: z.string().nullable(),
  // Normalized name (Latin, lowercase, no diacritics); alt names are extra search keys.
  nameNorm: z.string(),
  altNorms: z.array(z.string()),
  municipality: z.string().nullable(),
});
export const gazetteerSettlementSchema = z.object({
  id: z.number().int(),
  nameCyrillic: z.string(),
  nameNorm: z.string(),
  altNorms: z.array(z.string()),
  kind: z.string(),
  municipality: z.string().nullable(),
});
export const gazetteerResponseSchema = z.object({
  city: z.string(),
  version: z.number().int(),
  etag: z.string(),
  streets: z.array(gazetteerStreetSchema),
  settlements: z.array(gazetteerSettlementSchema),
});
export type GazetteerResponse = z.infer<typeof gazetteerResponseSchema>;
