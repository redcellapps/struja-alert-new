# Failure classes for later (not in scope now)

App scope is Niš city only, so none of these block Phase 1 or 2. They were found in rows from **other branches** that the Niš feed carries, and they must be handled when other areas are added. The real rows are saved byte-exact in `fixtures/failure-classes/cases.json` and guarded by `packages/parser/test/failure-classes.test.ts`, whose `todo` entries become real tests then.

Logged 22 Oct 2026 from the two collected snapshots (148 distinct rows over five branches).

## 1. "осим насељених места": a list of villages that are NOT affected

`територија општине Власотинце осим насељених места: Батуловце, Гложане, …` means the whole municipality is affected **except** the listed settlements. The splitter currently reads the listed villages as affected ones, which would warn exactly the wrong people.

**Needed:** recognise an exclusion list, and treat it as "the municipality, minus these settlements". A subscriber in the municipality whose settlement is not on the list is affected; one who is on the list is not. This matters for false positives and false negatives alike.

## 2. "Доња и Горња X": a shared name with an elided prefix

In the same row: `…, Градиште, Доња и Горња Лопушња, Острц, …` means two settlements, **Доња Лопушња** and **Горња Лопушња**. Splitting on `и` yields `Доња` and `Горња Лопушња`.

**Needed:** when a piece is a bare adjective (Доња, Горња, Мала, Велика, Нова, Стара, …) joined by `и` to a full name, expand it to the full name with the shared noun.

## 3. Names joined by a dot instead of a comma

`Рожина,Облачина.Облачинско језеро,Биљег,…` (Мерошина): the dot between `Облачина` and `Облачинско језеро` is a separator, not an abbreviation. Splitting only on `,` yields `Облачина.Облачинско језеро`.

**Needed:** treat a dot between two words with no space as a separator when it is not an abbreviation (`Ул.`, `Бул.`, `Св.`, `Нас.`, initials like `И.Л.Рибара`). The abbreviation list is a data file, so this is a data and rule problem, not a rewrite.

## Related, seen but not logged as separate classes

- Prose such as `и већи део Мерошине` (a "most of the municipality" claim).
- Whole-municipality rows (`територија општине …`).
- Novi Sad: house ranges as `од кбр 22 до …`; Kragujevac: `Ул.Војислава Калановића бр. 2` (no space after `Ул.`); Kraljevo: substation-style prose (`корисници који се напајају са извода …`).
