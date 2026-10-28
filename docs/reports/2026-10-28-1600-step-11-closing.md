# Step 11 closing: TalkBack passed, the two changed Maestro flows run

Date: 2026-10-28. Branch `main`. Everything up to `4b53575` is pushed. This report and the refreshed screenshots are one more commit, **not pushed**.

## TalkBack (owner, on the HONOR Magic6 Lite 5G)

Section 5 of `docs/phone-session.md` was done by the owner on the phone with the final build (keyboard, offline-map, municipality, share and calendar fixes in): **"all good, tested"**, no notes or failures reported. (The owner's own words; the per-line results were not sent.)

With the earlier automated part (calendar, share, "Otvori izvor", the map, offline map: `2026-10-28-1415-phone-session-automated.md`, `2026-10-28-1440-phone-fixes.md`), **every item of the phone checklist is now done**. After the session the phone stack was stopped: server, Metro, `adb reverse`, the database container (stopped, not deleted); the app was force-stopped on the phone (its data is untouched).

## The two changed Maestro flows, against the mock

`01-onboarding` and `04-tabs-and-settings` (they now choose the result with the keyboard up and assert the house number field) ran in **all four configurations**: light and dark, font 1.0 and 2.0 (`qa-screens --flows 01,04`): **8 of 8 passed** (6 and 12 screenshots per configuration). Real emulator evidence at 200 %: with the keyboard up the title and the city chips are collapsed and the field and its result are above the keyboard, with the proper municipality ("Medijana", "Crveni krst").

Environment: Metro (default API URL, 10.0.2.2) and the mock on :3000 as their own processes, Maestro 2.12.0, on the **`Pixel_10_Pro`** AVD (Android 17). **The `Medium_Phone` AVD does not boot any more** ("offline" in `adb` for over 10 minutes, four tries, also with 10 GB of free memory): probably damaged by the force-kills of the earlier attempts. It is not needed; `Pixel_10_Pro` works. Not repaired or wiped (tell me if you want it removed or wiped).

Screenshots: the committed set `docs/screens/android/qa/<config>/` was regenerated from the new runs (132 images, 7.7 MB; new: `add-address-3-picked`); the full-size working set stays in the git-ignored `step11/`.

## Gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · mobile **337** jest tests (+ 29 contract, 6 live skipped) as of `381afab`; server, parser, shared and scripts unchanged since step 11 began (256 / 177 / 23 / 62). Nothing in code changed after `381afab`.

## Open items

1. The municipality line is now proper everywhere in the search. Settings and other lists were not re-checked for the raw key.
2. The notifications-off banner and the delete confirmation are covered by the earlier adb sets and the jest tests, not by Maestro (unchanged).
3. Real push delivery is Phase 4 (not part of step 11).

## Decisions needed

1. Close **step 11** and go on to the next step in `docs/PLAN.md`?
2. Push this report commit?
3. Remove or wipe the broken `Medium_Phone` AVD?
