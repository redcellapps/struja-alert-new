# Phase 3, step 8: states, 200 % font, narrow screen, spoken labels (and the step 7 fixes)

Date: 2026-10-26. Branch `main`. **Nothing is pushed**: `25b3778` is the last pushed commit; `8209b02` (and the report commit after it) wait for Milan's OK.

## Commits

| Commit    | What                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------- |
| `8209b02` | Step 7 fixes, step 8 states and layout fixes, `a11y-screens` script, tests, CLAUDE.md and plan |
| (next)    | This report (`docs/reports/`)                                                                  |

## Gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · `pnpm test` green.
Tests: mobile **277** jest (was 273; +4 for large font) + 22 contract · server 227 · parser 144 (+3 todo) · shared 22 · scripts 62.

## Step 7 fixes (all four done)

1. **Status bar.** Scrolling text no longer runs under it: full screens get a strip in the page colour over the scrolling content (height = the status bar), sheets get a fixed header. Screenshot: `docs/screens/android/step7/podesavanja-light-4.png` and `podesavanja-dark-3.png` (scrolled, light and dark).
2. **Address actions** are small buttons with icons: "Glavna adresa" (star, lime when it is the primary one), "Promeni broj" / "Dodaj broj" (pencil), "Obriši" (trash) in the same red as "Obriši sve moje podatke" (`#DC2F34`). Same screenshots.
3. **"Српски"** in the Cyrillic interface (Latin: "Srpski"). `podesavanja-cirilica-dark.png`.
4. Step 8 as the audit below.

## Screen × state table

Read from the views and checked in the app. "NEW" = a gap found and filled in this step. "n/a" = the state cannot happen on that screen (reason given).

| Screen                                        | Loading                                        | Empty                                           | Error                                                                  | Offline (cached data)                                                     | Permission denied                                                                                                |
| --------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Onboarding** (3 steps)                      | n/a, nothing is fetched until the address step | n/a                                             | n/a (the address step has the add-address states)                      | n/a                                                                       | **NEW** warning banner "Obaveštenja isključena" with "Uključi" (opens system settings); before it was small text |
| **Add address** (sheet and onboarding step 3) | skeleton while the street index loads          | "no results for ..." text                       | street index error with retry; save error and "limit reached" messages | n/a: the street index is on the phone; a failed save shows the save error | n/a                                                                                                              |
| **House number** (Dodaj / Promeni broj)       | **NEW** skeleton while the address is read     | n/a                                             | **NEW** error with retry; save error message                           | n/a (a save without a connection shows the save error)                    | n/a                                                                                                              |
|                                               |                                                | **NEW** "address no longer exists" with Zatvori |                                                                        |                                                                           |                                                                                                                  |
| **Početna**                                   | skeleton cards                                 | "no address" with the add action                | error with retry                                                       | banner "Prikazujem sačuvane podatke"                                      | banner "Obaveštenja isključena" + "Uključi"                                                                      |
| **Najave**                                    | skeleton cards                                 | empty day / "no results"                        | error with retry                                                       | offline banner                                                            | n/a (the banner lives on Početna and Podešavanja)                                                                |
| **Istorija**                                  | skeleton cards                                 | empty history                                   | error with retry                                                       | offline banner                                                            | n/a                                                                                                              |
| **Podešavanja**                               | **NEW** skeleton in Adrese                     | **NEW** "Nemate sačuvanih adresa."              | **NEW** error with retry                                               | **NEW** offline banner                                                    | row "Obaveštenja su isključena" + system settings button (step 7)                                                |
| **Outage detail** (sheet)                     | skeleton                                       | "not found"                                     | error with retry                                                       | **NEW** offline banner when a refresh fails but a saved copy is shown     | n/a                                                                                                              |

Not covered by a screenshot: the new loading/error/empty states are covered by jest (settings states test, screen tests) and by reading the views, not by an emulator screenshot of each; the mock server has scenarios for offline and clear, not for a slow or failing API per screen. If Milan wants a screenshot of each error state I would add a `fail` mock scenario.

## 200 % font, narrow screen (360 dp), every control labelled

How: `pnpm --filter @struja/scripts a11y-screens <font2|narrow|narrow-font2>` on the emulator (1280x2856 at 480 dpi = 427 dp wide). `font2` = system font scale 2.0; `narrow` = `wm size 1080x2400` = **360 dp** wide; `narrow-font2` = both. It walks onboarding (3 steps), Početna, outage detail, Najave (list, search, follow sheet, outage), Istorija, Podešavanja (all pages), add address, house number; it stops if the heading of a screen is not where it should be, so it cannot photograph another app or screen.

| Config                 | Screenshots | Controls read | Without a spoken label |
| ---------------------- | ----------- | ------------- | ---------------------- |
| font2 (dark and light) | 61          | 586           | **0**                  |
| narrow (dark)          | 32          | 346           | **0**                  |
| narrow-font2 (dark)    | 35          | 287           | **0**                  |

Screenshots: `docs/screens/android/step8/<config>/`; the lists of what is spoken for each control: `a11y-labels.md` in each folder (`font2` and `narrow-font2` list the measured font scale and screen size; `narrow` was run before that line was added, its screenshots are 1080 px wide).

"Spoken label" is what TalkBack reads, taken from the accessibility tree (content description, or the text inside the control). Only the app's own controls are counted: the keyboard and the system bars are not ours, and the full-screen backdrop behind a sheet (a tap on it closes the sheet; the close button "Zatvori" is the labelled control) is left out. **This is not a run with TalkBack on**; the TalkBack checklist on Milan's phone is still part of step 11.

### Layout problems found at 200 % / 360 dp, and fixed

| Problem                                                                  | Fix                                                                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Outage detail: time broke as "14:00–18:0 / 0"                            | one line, shrinks to fit                                                            |
| Tab bar: "Podešavanja" cut to "Podeš…"                                   | tab labels follow the system font only up to **110 %** (Material caps them as well) |
| Day tiles (pon 26 ...) forced square, text overflowed                    | square only up to 130 % font; above that the height follows the text                |
| Tile caption "isključenje" broke in the middle                           | caption is one line that shrinks                                                    |
| Pismo / Tema choices broke words ("Ćirilic/a", "Svetl/a")                | above 130 % font the choices stack, one per row                                     |
| Long button text ("Otvori sajt Elektrodistribucije") broke inside a word | button labels follow the system font up to **150 %**                                |

Checked after the fixes at 200 % and at 360 dp + 200 %: no clipped text, no word broken in the middle, tab bar fits.

## Decisions for Milan

1. **Tab labels capped at 110 %, button labels at 150 %** (everything else scales to 200 %). This is a deliberate exception so four tab names and long words fit; approve or tell me to let them scale fully.
2. **Dev warning toast.** The debug build shows, now and then, a red React Navigation toast: "Looks like you have configured linking in multiple places ... Only a single instance of the root component is rendered". It covered the tab bar during the capture runs. I did **not** look for its cause (I only made the capture script close it). It is probably a development-only effect (a second root after a deep link or after the theme switch), but I have not verified that it cannot happen in a release build. Want me to look into it before step 9?
3. **Push:** `8209b02` and the report commit. I will not push without your OK.

## Honest limits

- Many capture runs were thrown away: the script photographed YouTube, a loading screen, or the wrong tab (stale accessibility dump, the dev toast and the open keyboard covering the tab bar, a sheet dismissed by a swipe). All of that is fixed in the scripts and the results above come from runs that verify the screen. None of it touched app code, except the layout fixes listed.
- "Najave" title "Naredna 4 dana" at 360 dp + 200 % reaches the right edge of its tile; it fits, but with no spare room.
- Screenshots are **not in git**: `.gitignore` has an `android/` entry that also matches `docs/screens/android/`, as in the earlier steps. They are on this machine only.
- Fast Refresh and bundle downloads on the debug build make the capture slow (about 10 minutes per configuration); that is the dev client, not the app.

## Next

Step 9, Real API (point the app at the local Docker stack and fix contract gaps), after Milan's review. Stopped here.
