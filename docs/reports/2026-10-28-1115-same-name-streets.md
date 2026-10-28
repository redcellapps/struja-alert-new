# Same-named streets are different streets (priority fix, found through the map)

Date: 2026-10-28. Branch `main`. Stopped for review after this fix, as asked; the map zoom (item 2) and step 11 (item 3) are **not started**.

## Git

`04d8aa7` (step 10) and `11f0e61` are pushed. This fix is one commit after them, **not pushed**.

## The problem, measured

`buildNisGazetteer` merged every OSM way with the same `name_norm` into one street (BRIEF §3 said "deduplicate by `name_norm`"). On the saved Niš data: 4,838 named ways, 2,251 names, **805 names with more than one way**; with a 500 m gap rule **136 names fall apart into streets that are kilometres from each other** (your figure: 130 with parts more than 3 km apart). Examples: Војводе Путника is 48 ways in two places (47 in the city, 1 in Трупале, centroids about 7 km apart); Маршала Тита is in eight villages; Чегарска in four places; Студеничка in three. Matching used only `street_id`, so a saved address on one of them was alerted for an outage on its namesake, and the map drew all of them.

## What changed

**One name is not one street (parser, `osm.ts`).** Ways with one name are one street only when connected or within **500 m** of each other (chained). I tested the settlement as a merge condition too: with only village points to go on (the data has no polygons) it split continuous city streets between neighbouring villages (136 names split by distance alone, 225 with "nearest village" added), so the settlement is the **label**, not a merge rule. Each street has a stable `clusterKey` (its smallest OSM way id), its own geometry and municipalities, and a `settlement` (the nearest place, in Cyrillic). 2,250 streets became **2,452**.

**Resolving a name that belongs to several streets (`resolve.ts`, `row.ts`).**

1. By the **municipality of the EDS row** (one street of that name in it: placed).
2. Then by the **distance to the row's other streets**: the nearest wins if it is within 3 km and at least 1.5 km nearer than the next (`SCORING.placeMaxMeters` / `placeLeadMeters`, provisional like the other constants). Names of one row that are all still ambiguous lean on each other's candidates (a third round).
3. Otherwise **no street is chosen and every candidate gets "Moguće"** (new steps `placed` and `ambiguous`).
   The swap, "missing word", "stray бб" and fuzzy steps, the scoring step and an alias of such a name all go through the same placement instead of failing on the conflict.

**Server.** Migration `0010_same_name_streets` (additive: `cluster_key`, `settlement_name`, `UNIQUE(city, name_norm, cluster_key)`, enum values `placed`, `ambiguous`). The importer upserts by `(city, name_norm, cluster_key)`, gives each OSM address point to the nearest street of its `addr:street` name, and **replaces the old name-merged rows**: whatever pointed at one (a saved address, an outage row, an alias) moves to the split street of that name with the most geometry, then the old row is deleted. The matcher tells **every candidate of an ambiguous segment "Moguće"** (new reason `same_name`, with its own push text) and nobody else; the planner and the on-screen list look the candidates up too (all of them are stored, not the top five). A placed segment concerns only its own street. New dev command `pnpm --filter @struja/server dev:import-gazetteer` (local database only); the server also imports at start with `IMPORT_GAZETTEER=true` when old rows exist.

**API and app.** The gazetteer gives every street a `settlement`; each outage segment gives its `streetId` (so "Prati" follows exactly that street); an ambiguous name is drawn on the map as every candidate (`properties.candidate`, dashed and lighter). Search shows the settlement and municipality under names that repeat ("Vojvode Putnika · Stočni trg"), and the detail says "Više ulica nosi ovo ime, a obaveštenje ne kaže koja je. Zato javljamo svima na tim ulicama."

**BRIEF §3** (Gazetteer, and the `street` data model line) now says all of this; the first version's "deduplicate by `name_norm`" is named as the mistake.

## The dev database (migrated)

|                                  | before                       | after                                                                                    |
| -------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| street rows / distinct names     | 2,250 / 2,250                | **2,452** / 2,250                                                                        |
| old merged rows left             |                              | 0 (2,250 replaced)                                                                       |
| subscriptions                    | Цара Душана 80, Требињска 34 | moved to the split street with the most geometry (Нова железничка колонија, Паси Пољана) |
| outage rows pointing at a street | 108                          | 108, moved the same way (history only: dev data)                                         |
| address points                   | 63,419                       | 63,419, now per street (Војводе Путника: 144 in the city, 12 in Трупале)                 |
| gazetteer version                | 1                            | 2                                                                                        |

Checked live: a Палилула row naming Војводе Путника is `placed` in the city street; "делови Горњоматејевачке и Студеничке" in Пантелеј is `ambiguous`.

## Phase 1 labels and the synthetic test: what changed

**Labels (`label-sample`, the 10 reviewed in-scope segments).** Four rows changed, nothing else:

| segment                     | before                  | after                                      |
| --------------------------- | ----------------------- | ------------------------------------------ |
| Горњоматејевачке (Пантелеј) | form → Горњоматејевачка | **ambiguous**: Виник or Каменица           |
| Студеничке (Пантелеј)       | form → Студеничка       | **ambiguous**: Пантелеј or Горњи Матејевац |
| Војводе Путника (Палилула)  | exact                   | **placed in Сточни трг**                   |
| Чегарске (Нишка бања)       | form                    | **placed in Нишка Бања**                   |

The ambiguous pairs are real, not a weakness: Студеничка (Пантелеј) touches Горњоматејевачка (Виник) at 0 m, and Студеничка (Горњи Матејевац) lies 1.4 km from Горњоматејевачка (Каменица): two consistent readings, so both are told "Moguće". The reviewer's `ok` was about the name and is kept.
**Gate on this sample:** automatic resolution **100% → 80%** (8/10; the two ambiguous ones are not counted as resolved, and are reported separately), auto-accept precision **100% → 100%** (8/8), new step `placed` 2/2. Still `INSUFFICIENT_SAMPLE` (10 of the 200 needed). `gate-report` now counts `placed` as an automatic accept and prints the ambiguous count. Aliases unchanged (8 reviewed); `label-sample` lists settlements for ambiguous candidates and "placed in …" for placed rows.

**Synthetic test (SYNTHETIC, not a measurement).**

|                                          | before                                                 | after                                                                   |
| ---------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| streets / cases                          | 2,250 / 7,126                                          | 2,452 / 7,690                                                           |
| accepted                                 | 81.8%                                                  | **78.0%**                                                               |
| precision of accepted                    | 100.0% (0 wrong)                                       | 99.97% (**2 wrong of 5,997**)                                           |
| genitive / typo / dropFirst / swap       | 99.4 / 77.1 / 50.7 / 99.7 %                            | 93.4 / 73.5 / 49.3 / 95.9 %                                             |
| by step                                  | form 2,237 · heuristic 1,865 · scored 1,673 · fuzzy 51 | form 2,105 · heuristic 1,780 · scored 1,582 · fuzzy 51 · **placed 483** |
| ambiguous cases (all candidates offered) | n/a                                                    | **305, 0 of them without the true street**                              |

The accept rate falls because a name that several streets share, given only a municipality, is no longer "accepted": 305 cases stay ambiguous (and none misses the true street). The two wrong accepts ("toplica" for Топличка → Милана Топлице; "vaska" for Влашка → Васка Попе) are an old weakness of the "token of another street" heuristic: I resolved the same inputs against a merged gazetteer and both are accepted there too; the changed street list only changed which typos the fixed random sequence produced. Worth a look before the Phase 5 freeze.

## Tests added or changed

- Parser (`same-name-streets.test.ts`, 17 tests): the clustering (touching, within the gap, chained, farther apart, stable order); placement by municipality, by distance, none when nothing decides, narrowing to the municipality's streets, an alias of a shared name, the mutual round; **real data: Војводе Путника is two streets (city and Трупале), Маршала Тита is in at least eight places none within the gap of another, a Палилула row means the city street**.
- Server (`same-name.test.ts`, 14 tests, real Postgres): the matcher (a placed segment does not reach the namesake; an ambiguous segment is "Moguće" for every candidate and nobody else; all eight candidates, not five); **an address on the other same-named street is not alerted** (Палилула row → city street only, Црвени крст row → Трупале only); ambiguous Чегарска → every Пантелеј candidate, not the Нишка бања one; the on-screen list and the detail (segment `streetId`, candidates drawn); the importer (one row per street with its settlement, address points to the nearest street, ids stable on re-import, **old row replaced and the saved address moved**), and the gazetteer API.
- Existing tests moved to the new model (rows that named Студеничка or Чегарска in a municipality where several exist now name one where it is one street; the real-pages tests accept an ambiguous result only if all its candidates carry the right name). App: search and the settlement line, following by street id, the `same_name` note. Scripts: labels and the gate.

## Gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · `pnpm test` green. Tests: mobile **324** jest + 29 contract (6 live skip) · server **256** · parser **165** (162 + 3 todo) · shared **23** · scripts **62**. The live contract against the real local server also passes (6 tests, including two Војводе Путника streets with different settlements). Screenshots: `docs/screens/android/step10b/` (git-ignored working set).

## Limits and notes

- The settlement label is the nearest place point, so a city street is named after a neighbourhood ("Stočni trg"); the app shows it with the municipality. Good enough to tell two streets apart; no polygons to do better.
- The 500 m gap, and 3 km / 1.5 km for placement, are provisional like `SCORING`; re-check with real labels (only 10 in-scope ones so far).
- The OSM house-number feature of the scoring is still keyed by name (all streets of the name together): weak and conservative.
- The old outages in the dev database were moved to "the split street with the most geometry": right for the one checked (Војводе Путника → city), approximate in general; no real data was affected.
- An ambiguous segment is shown in the street list by its raw EDS text (Cyrillic), as unresolved segments always were.
- The correct commit hash of the step 8 follow-up (`6ce2cf0`) and step 9 are unchanged and pushed.

## Decisions needed

1. OK to push this fix?
2. Then item 2 (map zoom to the house, or to the person's street, with "Celo isključenje") and item 3 (step 11, install Maestro)?
