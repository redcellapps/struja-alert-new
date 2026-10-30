# Phase 1 gate: the collector's missing runs, the village names of Niška Banja, the rate on everything collected

Date: 2026-10-30. Branch `main`. `aeb4c94` (the phone session) is **not pushed**; this report's commit is **not pushed** either. The phone session's stack (server, Metro, tunnels) is still up and untouched.

## 1. The collector

**Why the runs are missing.** `gh run list` for `collect.yml` shows 25 runs since 22 Oct, every one `success`, 22 of them scheduled. None failed and none was skipped by GitHub: they ran late. The cron is set for 05:05/06:05, 11:05/12:05, 17:05/18:05 UTC; the runs started at, for example, 09:56Z on 23 Oct (4.8 h after the 05:05 trigger), 15:42Z (4.6 h after 11:05) and 20:19Z (3.2 h after 17:05); on 26 Oct 10:58Z, 17:16Z, 22:35Z. The collector then logged "Outside the collection window (07/13/19 Europe/Belgrade, one hour each); nothing to do." and exited green. Only three scheduled runs fell inside a one-hour window: 22 Oct 17:03Z, 28 Oct 18:18Z and 29 Oct 18:23Z, which are the three slots on the branch. The 07 slot never ran inside its window, so the daily slug rediscovery never ran scheduled either (the manual runs' `slugs.json` was reused; it was not the cause of anything).

**The fix (this commit).**

- Cron every hour (`5 * * * *`). A run belongs to the latest slot that has begun: the window of a slot is [slot, next slot) — 07:00–12:59 is the 07 slot, 13:00–18:59 the 13 slot, 19:00–06:59 the 19 slot of the day it started on. The first successful run in the window collects the slot; the slot marker keeps later runs in the same window from collecting twice. Manual runs keep their own `manual-*` key. Tests rewritten on the real late start times (`scripts/test/slots.test.ts`, `collect.test.ts`).
- **The alarm: `collect-watch.yml`**, daily at 01:20 UTC (02:20 CET), checks the last whole Belgrade day on the `fixtures-collect` branch (`pnpm --filter @struja/scripts collect-watch`, pure file checks, no network). A day with no slot at all **fails the workflow**, which GitHub mails to you, and the workflow then **opens an issue** "Collector: no EDS fixtures on <date>" with the label `collector`, or comments on the open one, with a link to the run. A day with one or two of three slots is logged, not alarmed (one slot a day is enough for the gate; the hourly cron should give three). Why an issue rather than only the failure mail: the mail depends on your notification settings for the actor of the workflow file, the issue is in the repository for anyone.
- Nothing changes in what is requested from EDS: still at most three slots a day, same User-Agent, same robots check.

What to expect: from the next hour on, the branch should gain `2026-10-30-13` (or `-19`) and from tomorrow three slots a day. The watchdog's first real check is tonight; you can run it by hand from Actions with a date.

## 2. The parser: settlements written like streets

The rows, verbatim from the branch (28 and 29 Oct, Niš):

- Нишка бања: `делови Банцарева, Чукљеника, Доње Студене, Горње Студене, Бојаниних вода;`
- Палилула - Ниш: `делови Белопаланчке (бб), Старе Железничке Колоније (1-10), Станоја Бунушевца (13,23,27,37), Таковске (37), Милана Ракића (1), Божидарчеве (10-26), Железничке Колоније (1);`

Before: the five Niška Banja names and "Старе Железничке Колоније" were in-scope **street** segments, `unresolved` (the "село"/"насеље" markers that flag a village were absent, and the street ladder found nothing).

What was done:

- **The row resolver** (`packages/parser/src/row.ts`): a street segment the ladder could not place at all (no street accepted, not ambiguous) now falls through to the settlement list and the reviewed village aliases; if a settlement matches, the segment becomes `village`. A real street always wins, so "делови Горњоматејевачке и Студеничке" stays two streets (tested). The genitive forms match through the existing form generator: Банцарева → Банцарево, Чукљеника → Чукљеник, Доње Студене → Доња Студена, Горње Студене → Горња Студена (all four are OSM villages of Niška Banja with boundaries).
- **Бојанине воде is not in OSM** (no place node, no boundary). It is added as a hand-kept settlement (`packages/parser/data/settlements.ts`: kind `locality`, municipality Niška Banja, no coordinates, a negative id, with the genitive-plural spelling "Бојаниних вода" that the case generator does not produce). It goes through the normal import into the `settlement` table without geometry, so a person there can save the place. When OSM gains the node, the entry can go.
- **"Старе Железничке Колоније" is the neighbourhood Железничка колонија** (OSM: a `neighbourhood` node in Palilula, and separately a street of the same name, and a second neighbourhood "Нова железничка колонија"). It is a reviewed **settlement alias** in `packages/parser/data/aliases.json` (`reviewed: true`, dated today on your word). To carry it: a reviewed alias may now name a `settlement` instead of a `street`; the gazetteer import writes it to `settlement_alias` (where the admin review also writes), and the label builder and `label-sample` pass the reviewed village aliases to the resolver. "Железничке Колоније (1)" on the same row stays the street (form match, house number 1).
- **Tests on the real rows**: `packages/parser/test/villages.test.ts` (four cases, real OSM snapshots and the real cells) and one server import case (the settlement alias is loaded, the extra settlement is stored without geometry and resolves from "bojaninih voda").

## 3. The gate on everything collected

The branch's three scheduled slots (`2026-10-22-19`, `2026-10-28-19`, `2026-10-29-19`, 20 pages each) are now in `fixtures/eds/` beside the two manual ones, committed, so the measurement is reproducible and the tests can use the rows. `label-sample` then `gate-report`:

|                                                             | before (your figure) | after            |
| ----------------------------------------------------------- | -------------------- | ---------------- |
| in-scope street segments                                    | 47                   | 41               |
| resolved automatically                                      | 38 (80.9%)           | 38 (**92.7%**)   |
| ambiguous (several streets, none chosen, all told "Moguće") | 3                    | 3                |
| in-scope village segments                                   | 0 resolved           | 6, all resolved  |
| confirmed                                                   | 10 of 200 needed     | 10 of 200 needed |

Read it honestly: the six names moved from the street column to the village column and all six resolve there; no street resolution changed. The remaining three unresolved street segments are the ambiguous same-name cases, which the design leaves ambiguous by choice. The gate verdict is still **INSUFFICIENT_SAMPLE** (10 confirmed; 200 needed), and the sample itself (41 + 6 segments from five days) is far below what the gate wants; the hourly collector is what grows it. Auto-accept precision stays 8/8 on the confirmed rows. 31 rows wait for your review in `fixtures/labels.csv`.

## Tests and gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · tests: parser **178** (+4, +3 todo), scripts **65** (+3), server **277** (+1), mobile 378 + 24 contract (6 live skipped), shared 23. One full run, exit 0.

Also changed: `CLAUDE.md` (the collector's rule, the watchdog, how to bring the branch's slots in).

## Decisions needed

1. Whether to push this commit and `aeb4c94` (the new cron and the watchdog take effect only when `collect.yml` and `collect-watch.yml` are on `main`).
2. Confirm the two facts I took on your word and encoded as reviewed: the alias "Старе Железничке Колоније" → neighbourhood Железничка колонија (not "Нова железничка колонија"), and Бојанине воде as a locality of Niška Banja without coordinates.
3. The watchdog alarms only on a day with **no** slot; say if you want it on fewer than three.

Then back to Phase 4: the widget (step 4), with the three open decisions of the phone report still waiting.
