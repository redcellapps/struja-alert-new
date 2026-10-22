// City slugs appear in links like `Nis_Dan_0_Iskljucenja.htm` on the EDS branch index pages.
// The Belgrade links (`Dan_0_Iskljucenja.htm`) have no slug and are not matched here.
const LINK = /([A-Za-z0-9_]+?)_Dan_\d+_Iskljucenja\.htm/g;

export function extractSlugs(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(LINK)) {
    if (m[1]) found.add(m[1]);
  }
  return [...found].sort();
}
