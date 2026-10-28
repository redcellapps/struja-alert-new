# Phase 3 report: design system and Android app

Status: **built, tested on an emulator and on a real phone, not released.** The app talks to the local Docker stack and to a mock API; there is no production server yet, and push notifications are not delivered (Phase 4). iOS code paths compile; nothing has run on iOS.

## What is done

| Step | Delivered                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Expo SDK 58 shell, tokens, theme (light, dark, system), i18n in sr-Latn, sr-Cyrl and en, the typed API client (every answer parsed with the shared zod schemas), a typed mock API                                                                                  |
| 2    | 28 components in isolation, redone in design direction v2 (flat fills, bento cards, one lime accent, Onest) after the first design review; gallery with a type specimen; design review in light and dark (`docs/screens/android/design-review-v2/`)                |
| 3    | Onboarding (three steps) and the Add address sheet: city picker, instant offline street search, optional house number with suffix, labels, up to three addresses with a primary, confirmation line; no location permission                                         |
| 4    | Početna: status hero for the primary address in five states, four-day strip, tiles, address cards, pull to refresh, freshness line, EDS credit                                                                                                                     |
| 5    | Outage detail sheet: date, window, countdown, 24-hour bar, the person's ranges and number ("Vaš broj 34 je u opsegu …", "Moguće pogođeno"), affected streets, raw EDS text, calendar (system add-event screen, no permission), share, open source, report an error |
| 6    | Najave (grouped by day, searchable, follow any street) and Istorija (offline, grouped by month, yearly summary)                                                                                                                                                    |
| 7    | Podešavanja: script, language, notification kinds, quiet hours, manage addresses, privacy and delete-my-data, about                                                                                                                                                |
| 8    | Every state on every screen (loading, empty, error, offline with saved data, permission denied), audited as a screen × state table; checked at 200 % font and on a 360 dp screen; every control has a spoken label                                                 |
| 9    | The app against the real API on the local Docker stack; contract gaps fixed; `live-contract` runs the app's own client against it                                                                                                                                  |
| 10   | The outage map: MapLibre with OpenFreeMap tiles, own light and dark styles, never blank, credits always visible, no location, no offline tile download (`docs/map.md`)                                                                                             |
| 11   | Android design QA with Maestro (4 flows × 4 configurations), the phone session and its checklist, TalkBack by the owner                                                                                                                                            |
| 12   | iOS paths compile: `typecheck` also runs `tsconfig.ios.json`, `bundle:ios` bundles the app for iOS, the iOS tab bar and other iOS-only polish are stubbed and marked **[MAC]** (`docs/ios-mac.md`)                                                                 |

Two things came up on the way that the plan did not foresee, and both changed the backend and the gazetteer: **streets that share a name** (found through the map: they are now separate streets with a settlement label, migration `0010`, a partial-name rule with 0 wrong accepts on the synthetic test) and the **map readiness test** (found on the phone). They are in the deviations table of `docs/phase3-plan.md`.

The final Android and iOS application id is **`rs.strujaalert.app`** (it was a placeholder, `rs.example.strujaalert`, until 28 Oct). The app installs and starts under it on the emulator; the old build was uninstalled there.

## Screens

Android, in `docs/screens/android/`: `qa/<config>/` is the committed final set (132 images, light and dark at font scale 1.0 and 2.0: onboarding, every Početna scenario `clear / upcoming / imminent / active / cancelled / possible / three / offline / fail`, the outage detail with the map, the streets, the actions, the raw text and the share sheet, Najave, Istorija, the four Podešavanja screens and the Add address sheet). The earlier per-step sets (`step4` to `step10b`, git-ignored working sets) and the design reviews (`design-review/`, `design-review-v2/`) show how the screens developed. Routes: `onboarding`, `(tabs)` with `index`, `najave`, `istorija`, `podesavanja`, the sheets `add-address`, `edit-address` and `outage/[id]`, and the development-only `gallery`.

## Tests and coverage

All green on the final tree: `pnpm lint` (zero warnings), `pnpm typecheck` (including iOS), `pnpm test` (two packages at a time).

| Area                             | Test files           | Tests                 | Statements | Branches | Lines  |
| -------------------------------- | -------------------- | --------------------- | ---------- | -------- | ------ |
| `apps/mobile` (jest)             | 27                   | 343                   | 85.3 %     | 84.5 %   | 86.4 % |
| `apps/mobile` (contract, vitest) | 2 (+1 live, skipped) | 23 (+6 live, skipped) |            |          |        |
| `apps/server`                    | 19                   | 256                   | 92.1 %     | 83.7 %   | 93.9 % |
| `packages/parser`                | 15                   | 174 (+3 todo)         | 96.3 %     | 85.5 %   | 98.8 % |
| `packages/shared`                | 2                    | 23                    | 95.5 %     | 90.7 %   | 96.3 % |
| `scripts`                        | 7                    | 62                    | 95.9 %     | 81.1 %   | 97.0 % |

The six "live" contract tests run against a real server and are skipped by default (`pnpm --filter @struja/mobile live-contract`).

Mobile tests by subject: tokens and contrast, formatting (Belgrade time, durations, countdown), range highlighting, search and the gazetteer, stores, every component and its states, each screen, large font and narrow screens, the map (readiness, the start view, the button, the credits, the logging filter), the keyboard, the typing collapse, calendar and share text, the iOS paths, the merged Android manifest (no calendar or location permission), i18n in three languages.

**The Maestro flows** (`.maestro/`, run by `qa-screens` against the mock API in four configurations: light and dark, font 1.0 and 2.0): `01-onboarding`, `02-home-scenarios`, `03-detail-and-actions`, `04-tabs-and-settings`: 16 runs, all passed (the two flows changed after the phone session, 01 and 04, were run again: 8 of 8). Maestro does not cover the notifications-off banner, the house number form, the delete confirmation and the empty Najave and Istorija; the earlier adb screenshot sets and the jest tests do.

**One flaky thing in the gate:** with all five packages at once a server test worker crashed twice on Windows (exit 3221226505, in `same-name.test.ts`, under memory load; the file passes alone and in a run of two packages at a time). `pnpm test` therefore runs two packages at a time now.

## The phone session

HONOR Magic6 Lite 5G, Android 15, arm64 debug build, Metro and the real local API through `adb reverse` over USB (`docs/phone-session.md`). Results (reports `2026-10-28-1415-phone-session-automated.md`, `1440-phone-fixes.md`, `1600-step-11-closing.md`):

| Item                                                               | Result                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install, tunnels, bundle, data from the local API                  | OK                                                                                                                                                                                                                            |
| Onboarding, search, house number, save; Početna with a live outage | OK (after the keyboard fix)                                                                                                                                                                                                   |
| Calendar                                                           | OK: the system "New event" screen, no permission prompt, the right window in Belgrade time; the notes list every street of the outage with ranges; discarding returns to the detail                                           |
| Share                                                              | OK: the system sheet; when, every street of the outage, the EDS credit; **never the person's saved addresses or house number** (owner's decision)                                                                             |
| "Otvori izvor (EDS)"                                               | OK: the phone's browser, not a webview; Back returns to the app                                                                                                                                                               |
| Map                                                                | OK: starts on the house, labels readable (checked in Latin script and the dark theme), "Celo isključenje" / "Moja adresa", credits open the OSM copyright page, a swipe on the map scrolls the sheet and the map does not pan |
| Map offline (airplane mode)                                        | OK after the fix: after the 8 s timeout the map is gone and the street list follows, no blank box                                                                                                                             |
| Keyboard over the street field                                     | Found on the phone, fixed (the field and its results stay above the keyboard in onboarding and in the Add address sheet), re-checked on the phone                                                                             |
| TalkBack (section 5 of the checklist)                              | Passed, by the owner, with the final build; no notes                                                                                                                                                                          |

Not checked on the phone: the map in the light theme and in Cyrillic, the shared-name outage in Pantelej, the largest font on the phone (the emulator holds it), real push (Phase 4).

## Known limits

- **A release build cannot reach `http://10.0.2.2:3000`** or any plain-HTTP API (Android blocks cleartext): a release or store build needs the API behind https. Debug builds allow it.
- **Font size change while the app is open** restarts the Android activity and resets to Početna (React Native 0.88 does not refresh `fontScale` without a resume): `docs/known-limits.md`. In a debug build Metro re-opening the app shows a development-only "linking configured in multiple places" warning.
- **Push is not delivered.** The server only logs; dev builds register `dev-token:<uuid>`, accepted only when `NODE_ENV=development`. The notification permission is asked in onboarding, and the "notifications off" banner appears when it is denied or skipped, but nothing is sent until Phase 4.
- **The map depends on a public tile host** (OpenFreeMap): no service guarantee, no offline tiles (by decision), attribution required. The host is set in one file (`src/map/config.ts`) so it can be changed. Production tile hosting is an open decision.
- **Resolution quality is still not proven** (the Phase 1 gate has too small a sample; the weights are provisional). The same-name and partial-name rules are measured on the synthetic test only (strict: 67.5 % resolved with 0 wrong; with the neighbouring streets: 87.3 % with 0 wrong): never a measurement on real data.
- **Streets of the Niš gazetteer only.** The other cities are "Uskoro"; the municipality names shown are the five Niš city municipalities.
- **The calendar's location field** holds the person's own address from that outage; it goes into their own calendar. The share text and the calendar notes list streets only.
- **Maestro** needs Maestro 2.12.0 (installed in `C:/tools/maestro`, not on the global PATH), Metro, the mock API and a debug build; it clears the app's data. The debug build for the emulator is x86_64, the one for a phone arm64 (the two are built separately).
- **Android emulator on this machine:** the `Pixel_10_Pro` AVD works; the `Medium_Phone` AVD stopped booting after force-kills and was deleted. The emulator needs about 4 GB of RAM whatever the AVD says.
- **USB to the phone dropped several times** during the session (typically after 10 to 20 minutes; the phone kept showing as a media device while `adb` lost it, and USB debugging had to be switched off and on again). Not an app problem; a different cable or port may help.
- **iOS has never run.** Everything marked **[MAC]** (`docs/ios-mac.md`) is a stub that compiles: the iOS tab bar (Liquid Glass), sheet detents, SF Symbols, the calendar editor, notification permission, `infoPlist`. The iOS smoke build and VoiceOver are Phase 6.
- **Old Android app id on the owner's phone:** `rs.example.strujaalert` is still installed there (the phone was not attached when the id changed); it must be uninstalled by hand or by `adb uninstall rs.example.strujaalert` when the phone is next attached. The new build installs next to it.

## Open decisions

1. **Phase 4 plan** (notifications: FCM and APNs, the Expo provider, the widget, Live Update): not started; waits for the owner's go.
2. **Firebase** project for `rs.strujaalert.app` and its FCM credentials (needed before any real push).
3. **Production API over https** (a domain and the reverse proxy decision from Phase 2) before any release build or store listing.
4. **Production map tiles:** keep the public OpenFreeMap host, or host or pay for tiles; and the Play "Data safety" form wording for the map.
5. **Phase 1 gate:** keep collecting and labelling until the sample is large enough, then freeze the scoring.
6. **Light theme, Cyrillic and Pantelej on the phone's map** and the largest font on the phone: a short second phone pass, or accepted as checked on the emulator.
7. **Other cities** (Beograd, Novi Sad): when the gazetteer and the municipality scope are extended.

## Next

Phase 4 (`docs/PLAN.md`). Not started.
