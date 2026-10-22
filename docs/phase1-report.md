# Phase 1 report: data spike (draft, 22 Oct 2026)

**Gate status: NOT passed, and it cannot be judged yet.** The gate needs ≥95% automatic resolution and ≥99% correct auto-accepts on a labeled sample of about 200 segments. We have **10 in-scope segments** from 2 snapshots (one day of data). The numbers below are real but tiny; the synthetic numbers are engineering signal, not a measurement.

## 1. What exists

| Piece                                                                 | State                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture collector (`scripts/`, GH Actions, `fixtures-collect` branch) | Running. Two forced runs so far; the scheduled 07/13/19 slots start from the next window. Discovery from the five branch pages works.              |
| Collected data                                                        | 2 snapshots × 5 branches × days 0–3 (12 + 20 pages).                                                                                               |
| OSM gazetteer for Niš (`fixtures/osm/`)                               | Streets, address points, admin areas, per-municipality street ids and places, fetched from Overpass on 22 Oct 2026.                                |
| Parser (`packages/parser`)                                            | Page decode, page parse, Belgrade time, `Ulice` splitter, house ranges, normalizer, case forms, resolution ladder with spatial scoring. 126 tests. |
| `fixtures/labels.csv`                                                 | 68 distinct Niš-branch segments with proposed answers; `confirmed` column empty for review.                                                        |
| `packages/parser/data/aliases.json`                                   | 8 proposed aliases (non-exact matches) for review.                                                                                                 |

## 2. Answers to the open questions (BRIEF §10)

- **City slugs:** `Nis`, `Kraljevo`, `NoviSad`, `Kragujevac` (found on the five branch index pages; every index page lists all four). Belgrade has no slug: `planirana-iskljucenja-beograd/Dan_N_Iskljucenja.htm`.
- **How many days ahead:** day 0 to day 3. Day 4 returns 404 for all branches.
- **Encoding:** UTF-8 with a BOM, no declared charset; every page is valid UTF-8. A windows-1251 decoder exists as a fallback and is tested.
- **Truncated `Ulice` cell:** none seen in the 32 pages. Cannot be ruled out with this little data.
- **Apartment buildings vs houses:** nothing in the markup distinguishes them.
- **Do pages change during the day:** unknown. Snapshots 57 minutes apart were byte-identical, and `Last-Modified` for Niš day 0 was 00:01 the same night, which suggests overnight regeneration. The scheduled slots will show whether 07/13/19 pages differ.
- **How EDS marks changed or cancelled outages:** not marked in the markup (no status column). Change and cancellation must be inferred by comparing snapshots (identity key), as the brief plans.

## 3. Where the data contradicts the brief

1. **`Ulice` is free text, not `STREET: ranges`,** except on Belgrade pages. Niš examples: `делови Матејевачког пута (41,бб);`, `делови Чегарске (непарни бр. 9-53, парни бр. 30-44);`. Street names appear in running-text case forms (genitive), while OSM has nominatives. Each branch has its own style (Novi Sad: `од кбр 22 до …`; Kragujevac: `Ул.Војислава Калановића бр. 2`; Kraljevo: prose).
2. **The "Niš" page is a regional feed:** it also lists the Prokuplje, Zaječar, Pirot and Leskovac branches. Scope is therefore decided by page **and** municipality (the five city municipalities as EDS writes them: Медијана, Палилула - Ниш, Пантелеј, Црвени крст, Нишка бања). A bare `Палилула` is Belgrade's.
3. **OSM streets are many ways per name,** so a street's geometry is a list of polylines (MultiLineString), not one LineString.
4. **`alt_name` / `old_name` exist in OSM** and are used as extra exact names (e.g. `Булевар дванаести фебруар`).
5. Parity in words (`непарни`/`парни`) and `бб` do appear in real rows.
6. **How often EDS regenerates its pages (collector, 22 Oct 2026).** The Niš, Kraljevo, Novi Sad and Kragujevac pages were generated at 00:01 UTC and were unchanged at the 12:02, 12:59 and 17:04 UTC fetches. Belgrade was regenerated at 13:30 UTC: `Dan_1` gained a Čukarica outage 09:00–15:00, `Dan_2` lost its Zemun outage (08:30–13:30, a real cancellation: the table went from one row to empty), and `Dan_0` dropped two finished outages. Consequences: outside Belgrade the 07/13/19 scrapes mostly see an identical page (the content hash makes that cheap), and a page can go from one row to none legitimately, which is why the "fewer than half" broken-page rule applies only when the previous good fetch had at least 5 rows.

## 4. Gazetteer (22 Oct 2026 snapshot)

- 4,838 street ways → **2,250 streets** after merging by normalized name; 198 have alternate names; 4,837 of 4,838 ways are inside one or more of the five municipalities (55 on a border).
- **86 settlements** inside the five municipalities: 68 villages, 5 hamlets, 4 suburbs, 8 neighbourhoods, 1 town.
- 63,749 address points (used only for the house-number feature of scoring).

## 5. Resolution ladder

Order: alias → exact → **case forms** (forward-generated genitive/dative/accusative/instrumental of every gazetteer name) → number words ↔ digits → fuzzy (trigram ≥0.85 with a 0.10 lead) → heuristics (swapped words, stray бб, missing first name by word containment) → scored (string similarity incl. word containment, municipality, proximity to the row's other streets, house numbers) → unresolved with top-5 candidates.

Safety rules added after testing: a segment with no letters is never a street; a name that fits two or more streets is auto-accepted only when the row's other streets give spatial context; fuzzy needs a clear lead over the runner-up; anything ambiguous goes to review.

## 6. Measurements

### Real data (in scope = Niš page + one of the five municipalities)

|                                            | Count                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------- |
| Distinct Niš-branch segments (2 snapshots) | 68                                                                    |
| In scope                                   | **10** (10 street, 0 village)                                         |
| Out of scope (other branches)              | 58                                                                    |
| Resolved automatically, in scope           | 10 of 10                                                              |
| By step                                    | form 7, exact 2, heuristic 1 (number word: `прилаз два` = `прилаз 2`) |

These are the ladder's **proposals**; no human has confirmed them yet, so auto-accept **precision is not measured**. The scored step never fired on real rows. No Медијана or Црвени Крст rows have appeared yet. At roughly 10 new in-scope segments a day (estimate from one day), ~200 would take about three weeks.

### Synthetic stress test (NOT real EDS data)

`scripts/src/synthetic-eval.ts`: 7,126 perturbed names of the 2,250 real streets (genitive forms, a deleted letter, dropped first word, swapped words) plus junk strings. Truth is known; 17 inputs that equal another real street's name were excluded as unanswerable.

|                           | Accepted | Precision of accepts                |
| ------------------------- | -------- | ----------------------------------- |
| All cases                 | 81.8%    | 100.0% (0 wrong accepts)            |
| Genitive forms            | 99.4%    | 100%                                |
| Typo (one letter deleted) | 77.4%    | 100%                                |
| Swapped words             | 99.7%    | 100%                                |
| Dropped first word        | ~51%     | 100% (the rest are left for review) |
| Junk strings              | 0%       | n/a                                 |

By step: forms 100%, heuristic 100%, scored 100% (1,673 accepts), fuzzy 100% (51). The first run found real flaws (bare numbers, near-equal fuzzy rivals, bare names fitting several streets); each is fixed with a regression test. The thresholds are hand-set and **not tuned on real labels**; this test is easier than real data because its inputs are all derived from real street names.

## 7. Failure classes understood so far

- Inflected street names → solved by forward case forms.
- Number words vs digits → solved (`два` = `2`).
- Out-of-scope rows (other branches, other municipalities) → stored, flagged, never matched.
- Bare names fitting several streets → left for review unless the row's other streets decide.
- Villages and `Насеље X - …` blocks → parsed; village segments resolve against the 86 settlements. No in-scope village segment seen yet.
- Not yet seen: street names missing from OSM, spelling variants EDS uses that OSM does not, and rows naming landmarks or substations instead of streets (e.g. Kraljevo's `корисници који се напајају са извода …`).

## 8. What is needed to close the gate

1. A few weeks of the scheduled collector for a labeled sample near 200 in-scope segments.
2. Your confirmation of `fixtures/labels.csv` (`confirmed` column) and review of `aliases.json`.
3. Then tune the scoring weights and thresholds on the labeled sample and re-measure; report the sample size beside every percentage.
