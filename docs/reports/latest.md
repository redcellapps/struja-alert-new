# Phase 3, step 8 follow-up: large text on a narrow screen, live font change

Date: 2026-10-27. Branch `main`.

## What changed

- `fail` mock scenario (every `/v1` request answers the server's 500); its screenshots wait for step 11.
- Large-text layout: `BentoRow` (tiles one per row from font scale 1.5 or under 400 dp), `largeText.ts` hooks, stacked rows and full-width, uncapped buttons; `SectionHeader` puts the action under the heading at large text, and on a narrow screen with a raised font, so a heading never breaks mid-word ("Adres / e" is gone).
- `.gitignore`: working screenshots under `docs/screens/android/step*` and `design-review*` are ignored; only the final QA set is committed at step 11.
- `docs/known-limits.md`: the React Native 0.88 stale font-scale limit (revisit after an RN upgrade).

## Decision: no manifest change (as agreed)

I tried `fontScale|density` in `configChanges` (config plugin). Result: the process and the screen survived and no warning appeared, **but** React Native 0.88 refreshes `fontScale` only on resume, so after a live change the text rescaled and our layout did not (tiles stayed two per row at 200 %, and stayed stacked after going back to 100 %). The plugin is removed and the manifest is as generated. Android restarts the activity on a font or density change; the screen resets, which is accepted.

## Checks (debug build on the emulator, then release)

| Check | Result |
| --- | --- |
| "linking configured in multiple places" warning, debug | Only on a live font change (once per change). Not on a cold start, not on a deep link (warm: `strujaalert:///najave` opens Najave; cold). Cold deep links carry the dev `__expo_url` parameter and land on Početna, so only the warning was checked there |
| Početna at 200 %, fresh start | tiles one per row, buttons full width |
| 360 dp and 200 %, fresh start | tiles one per row, "Adrese" whole, "Dodaj adresu" under it |
| Release build (`--variant release`) | installs, cold start without a crash; at 360 dp and 200 % the error card (no API in this build) is laid out right: full-width button, no word break. A live font change restarts the activity in the same process |

Screenshots (git-ignored working set): `docs/screens/android/step8/followup/`.

Memory notes: one native build at a time and `gradlew --stop` after each; Gradle heap 2 GB (already `-Xmx2048m`), emulator RAM 2048 MB; the mock API runs as its own process. Two background commands were killed by the low-memory guard earlier in this step; nothing was lost.

## Gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · `pnpm test` green.
Tests: mobile **293** jest (was 277 at the step 8 report; +16) + 22 contract · server 227 · parser 144 (+3 todo) · shared 22 · scripts 62.

## Git

Commits: `8209b02` (step 8), `0227e33` (step 8 report), `9f1af80` (this one, report included). Pushed on Milan's OK in this terminal: all three.

## Decisions needed

None. Next: step 9 (app against the real API on the local Docker stack), after a proposal for a `.wslconfig` memory cap for Docker.
