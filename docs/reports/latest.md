# Follow-ups to the same-name fix: settlement labels, and "token of another street" only proposes

Date: 2026-10-28. Branch `main`. `2909f18` (the same-name fix) is pushed; these follow-ups are one commit after it, **not pushed**.

## 1. Settlement labels people recognise

**Before:** the label was the nearest OSM place node, so the city "Војводе Путника" was "Сточни трг" (a neighbourhood). **Now:** a village's own name, or the **city municipality** for a street in the city: "Vojvode Putnika · Palilula", "Vojvode Putnika · Trupale".

How: the repo's Overpass seed tool fetched one more snapshot, `fixtures/osm/nis-settlement-areas.json` (the 74 OSM settlement boundaries, admin_level 9: about 70 villages, Нишка Бања, and the four urban parts "Ниш (Палилула)", "Ниш (Медијана)", "Ниш (Пантелеј)", "Ниш (Црвени Крст)"; 3.2 MB; one query, polite user agent, nothing else requested). `packages/parser/src/areas.ts` assembles the boundary rings and finds the settlement a point lies in (the smallest when boundaries overlap). A street is named after the settlement most of its ways lie in; an urban part is named after its municipality. Where two streets of one name would still get the same label, a place or an ordinal is added in brackets (2 of the 136 names: "Црвени Крст (Доњи Комрен) / Црвени Крст (2)", "Пантелеј (1) / Пантелеј (Беверли Хилс)"). No street is left without a label. The app shows just the label under a repeated name (previously the label and the municipality); the dev database is re-imported.

**The list to check:** all 136 repeated names with their labels are in **`docs/repeated-street-names.md`** (regenerate with `pnpm --filter @struja/scripts repeated-streets`). The ones that matter most:

| name             | streets | told apart by                                                                                |
| ---------------- | ------: | -------------------------------------------------------------------------------------------- |
| Војводе Путника  |       2 | Палилула · Трупале                                                                           |
| Маршала Тита     |       8 | Доња Трнава · Бубањ · Доња Топоница · Суви До · Кравље · Мезграја · Медошевац · Палиграце    |
| Чегарска         |       4 | Пантелеј · Нишка Бања · Горњи Матејевац · Каменица                                           |
| Студеничка       |       3 | Пантелеј · Девети мај · Горњи Матејевац                                                      |
| Горњоматејевачка |       2 | Пантелеј · Каменица                                                                          |
| Цара Душана      |       4 | Медијана · Горња Топоница · Вртиште · Горње Међурово                                         |
| Бранка Бјеговића |       2 | Црвени Крст · Доње Међурово                                                                  |
| Првомајска       |       9 | Медијана · Габровац · Кравље · Трупале · Чокот · Бубањ · Мезграја · Горња Топоница · Вртиште |
| Требињска        |       1 | (not repeated: Палилула)                                                                     |

Tests: boundary assembly and point lookup (synthetic), the real boundaries (four urban parts, about 70 villages, every ring closed, the fortress is in the city, Трупале in its own village), and on the real data: the two Војводе Путника are "Палилула" and "Трупале", every street has a label, and no two streets of a name share one.

## 2. The "token of another street" heuristic only proposes

**Rule (resolver, BRIEF §3 step 4 updated):** a segment that is only some words of another street's name is a **proposal**, accepted only when

1. the street lies within **1.5 km of a street already resolved in the same EDS row** (the row confirms it spatially; `SCORING.partialConfirmMeters`), and
2. no more than **three** street names contain those words (a generic word such as "прилаз" is no place; `SCORING.partialMaxNames`), and
3. when it is the only name that contains them, **no street of another name sounds like the segment** (the typo of "Топличка" is not "Милана Топлице").
   Otherwise it stays a candidate: the scoring step lists it, the review queue and the safety net ("Moguće") can use it. The same rule covers the scoring step, which could also accept a partial name by itself. Rewrites that are not partial names (stray бб, swapped order, dates in words) are unchanged.

**Synthetic test (SYNTHETIC, not a measurement), re-run:**

|                                           | before the same-name fix | after it | **now, each name alone**           | **now, a neighbouring street named in the row** |
| ----------------------------------------- | ------------------------ | -------- | ---------------------------------- | ----------------------------------------------- |
| accepted                                  | 81.8%                    | 78.0%    | **67.5%**                          | **87.3%**                                       |
| wrong accepts                             | 0                        | 2        | **0**                              | **0**                                           |
| ambiguous cases (every candidate offered) | n/a                      | 305      | 288 (none without the true street) | 43                                              |
| dropFirst accepted                        | 50.7%                    | 49.3%    | 1.0%                               | 56.5%                                           |

"Each name alone" is the test as it was: the partial names ("dropFirst") are now only proposals, so they fall from 50% to 1%, and the typo and word-order cases are unchanged. The last column is a new `--with-context` mode: the row also names the nearest street of the true one, which is what a real EDS row does (one row is one area) and what the second pass of `resolveRow` uses; there the partial names are accepted again when the row confirms them (56.5%), and the typo cases reach 91%. Wrong accepts are 0 in both. The strict figure is the one to hold against the gate: a lot of EDS segments are partial names, so how many are accepted automatically on real rows depends on the other streets of the row; the labels will tell once there are enough of them.

Row tests: a partial name next to a street of its row 300 m away is accepted; alone, or in a row whose only other street is far away, it stays unresolved with the candidate listed. Resolver tests for the same, and for the "топлице" case.

## Phase 1 labels

`label-sample` re-run: the same four changed rows as before, now with the new labels in the candidate column ("Горњоматејевачка · Пантелеј (1.00); Горњоматејевачка · Каменица (1.00)", "placed in Палилула"). Gate on the 10 reviewed segments unchanged: resolution 80% (2 ambiguous), precision 100% (8/8), still `INSUFFICIENT_SAMPLE`.

## Gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · `pnpm test` green. Tests: mobile **324** jest + 29 contract (6 live skip) · server **256** · parser **177** (174 + 3 todo) · shared 23 · scripts 62. (Running all packages at once can lose a server test worker under memory pressure, as before; the server suite alone passes.)

## Left for later

- The partial-name thresholds (1.5 km, three names) are provisional like the other scoring constants; tune them on real labels.
- Next, as asked: the map zoom, then step 11 (Maestro, the phone-session preparation).
