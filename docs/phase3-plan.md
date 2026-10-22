# Phase 3 plan: design system and Android app

Scope: BRIEF §6 (all screens), §7 (design system, motion, states, accessibility, Android design QA). Android first; iOS code paths compile and iOS-only polish is stubbed and marked **[MAC]**. Notifications, the widget and Live Update are Phase 4. **Nothing here is built yet; this plan is for review.**

Starting point: the Expo SDK 58 shell in `apps/mobile` (native tabs `Početna · Najave · Istorija · Podešavanja` as placeholders, runs on the emulator), the `/v1` API (`docs/api.md`) with zod contracts in `packages/shared`, and the parser's transliteration and normalizer for search and sr-Cyrl.

## Decisions (22 Oct, resolved)

1. **Map:** before step 10 I present Google Maps (`expo-maps`) and MapLibre with an OSM tile service side by side: setup, billing account, monthly cost at 1,000 and 10,000 users, what each adds to the Play Data safety form, attribution, and dev-build compatibility. The owner leans MapLibre and decides after the comparison. Everything else is independent of the map.
2. **Development push token:** dev builds register with a token of a separate format, `dev-token:<uuid>` (never `ExponentPushToken[...]`). The server accepts it **only when `NODE_ENV=development`**; any other environment (and the default when `NODE_ENV` is unset) rejects it with `400 dev_token_not_allowed`. Both paths are tested (`apps/server/test/api.test.ts`). The real Expo provider (Phase 4) must never send to such a token. Real tokens need FCM credentials, which arrive in Phase 4.
3. **iOS smoke build moves to Phase 6** (the Apple Developer account is not ready). iOS code paths keep compiling through typecheck.
4. **Maestro:** approved, installed when step 11 starts, not before.
5. **Calendar export** uses the system "add event" screen (an intent), so the app never requests `READ_CALENDAR` or `WRITE_CALENDAR`. A check on the **merged Android manifest** (after prebuild) fails if any calendar permission appears.
6. **Design review after step 2:** I stop after the components exist, with emulator screenshots (adb, no Maestro) of the component gallery in light and dark and the status hero in all five states, in `docs/screens/android/design-review/`. No screens are built until the owner approves the look.
7. **App ID:** the Android application id is still a **placeholder**. The owner picks the final one **before Phase 4**, because Firebase registers it for push (changing it later means re-registering).
8. **Test server for QA runs:** Maestro flows use a small local mock API (zod-typed fixtures), not production. Connecting the screens to the real API is a separate step against the local Docker stack.

## Architecture

- **Routing:** Expo Router, native tabs (stable in SDK 58). "Add address" and "Outage detail" are modal bottom sheets (Android: Material sheet; iOS later: sheet with detents). Predictive back enabled (`android.predictiveBackGestureEnabled`) and verified.
- **Data layer:**
  - `src/api/`: a typed client built on the shared zod schemas (every response is parsed; a contract mismatch is a visible error, not a crash). Auth header `Bearer <deviceId>.<secret>` from `expo-secure-store`.
  - **TanStack Query** with a persisted cache (MMKV storage adapter) so Home, Najave and Istorija show the last data offline with the "Prikazujem sačuvane podatke" banner.
  - **Zustand** for settings (script, language, notification kinds, quiet hours mirror) and the local address list.
  - **Own address list on the device (agreed 22 Oct):** the app stores its addresses locally; if the device secret is missing it registers again (the server takes over the push token) and re-adds the addresses. Adding an address returns the already published outages, shown at once; nothing is pushed twice.
- **Gazetteer search offline:** `GET /v1/cities/nis/gazetteer` (ETag) cached in storage; the parser's `normalizeName` makes `vojvode misica`, `mišića` and `војводе` all match; results are instant and local.
- **i18n:** sr-Latn is the source; sr-Cyrl generated with the parser's transliteration plus a small override map; English separate. Street names follow the chosen script (`name_latin` / `name_cyrillic`). Notification copy already lives in `packages/shared`.
- **Time:** all times arrive as UTC ISO strings and are shown in Europe/Belgrade (the parser's Belgrade helpers).
- **Platform split:** `.android.tsx` / `.ios.tsx` only where chrome differs; logic and data are shared.

## Design system (`apps/mobile/src/design/`)

1. **Tokens** in one place with per-platform values: colour (semantic status colours `clear / upcoming / imminent / active / cancelled-past`, each with light, dark and high-contrast values; Material colour roles on Android with dynamic colour for chrome, fixed status colours), type (system font, tabular rounded numerals for countdowns), spacing (4-pt grid, 16-pt margins), radius (20–24), motion (springs, durations).
2. **Components:** `StatusHero`, `MeshBackground`, `DayStrip`, `AddressCard`, `TimelineBar`, `RangeChips`, `CountdownText`, `Banner` (offline, notifications off), `EmptyState`, `SkeletonCard`, `SectionHeader`. Each has loading, empty, error, offline and permission-denied variants where they apply.
3. **Motion and haptics:** Reanimated springs; hero cross-fade on status change; rolling countdown digits; gentle pulse in `active`; short list stagger; everything non-essential off under "Remove animations". Haptics only for chip selection, address saved, refresh done.
4. **Colour is never the only signal:** every status has an icon (Material Symbols via `expo-symbols`) and a text label.
5. **Dynamic colour check:** confirm early whether `@expo/ui` exposes the Material You palette for custom surfaces; if not, a small native module exposes it (planned in Phase 4 for Live Update anyway).

## Build order (each step ends with lint, typecheck, tests green and a commit)

1. **Foundations:** dependencies via `npx expo install` (verified versions, nothing pinned from memory), tokens, theme provider (light/dark/system), i18n scaffold with the three languages, the API client and a typed mock server for development and Maestro.
2. **Components in isolation:** the eleven components with a small in-app gallery route (development only) showing every state in both themes; component tests (jest-expo + Testing Library). **Then stop for the design review** (decision 6): no screen work before the owner approves the look.
3. **Onboarding (3 steps)** and **Add address** sheet: city picker (Niš active, others "Uskoro"), instant offline street search, optional house number with suffix, label chips, up to 3 addresses with a primary, confirmation preview. No location permission, ever.
4. **Početna:** status hero for the primary address, 4-day strip, address cards, pull to refresh, footer with freshness, EDS credit and disclaimer link.
5. **Outage detail** sheet: date, window, duration, countdown, 24-hour timeline with "now" marker, the user's ranges and number highlighted ("Vaš broj 34 je u opsegu 26–40", "Moguće pogođeno — niste uneli broj"), affected streets, raw EDS text expander, actions (calendar export through the system add-event screen, no calendar permission; share; open source; report an error).
6. **Najave** (grouped by day, searchable, follow any street) and **Istorija** (offline, grouped by month, yearly summary).
7. **Podešavanja:** script, language, notification kinds, quiet hours, manage addresses, privacy and "Obriši sve moje podatke", about (attribution, disclaimer, version, feedback).
8. **All states** on every screen: skeleton loading, empty, error, offline with cached data, permission denied.
9. **Real API:** point the app at the local Docker stack (seeded fake subscription) and fix contract gaps found.
10. **Map** on the outage detail, after the comparison and the owner's choice (decision 1).
11. **Android design QA:** Maestro (installed at the start of this step, approved) visits every screen and state against the mock API, with `takeScreenshot`, in light and dark and at font scale 1.0 and 2.0 (switched with `adb`) → `docs/screens/android/`. `docs/qa-checklist.md` with the TalkBack checklist for your phone.
12. **iOS paths compile** (`expo run:ios` is not possible on Windows; typecheck only; the iOS smoke build is Phase 6). iOS-only polish (Liquid Glass, detents, SF Symbols) stubbed and marked **[MAC]**.

## Accessibility

Font scale up to 200 % with reflowing layouts and no clipping; TalkBack labels as full sentences ("Isključenje struje u utorak od 8:30 do 12:30, Vojvode Mišića 34"); WCAG AA contrast; minimum touch target 48 dp; reduced motion respected.

## Tests

- Unit and component tests for tokens, formatting (Belgrade time, durations, countdown), range highlighting, search, store logic and each component state.
- The API client against recorded zod-valid fixtures; a contract test that parses every shared schema example.
- Maestro: onboarding → add address → see outage → open detail (the acceptance flow), plus the screenshot runs.

## Risks to watch

- **Predictive back and Material 3 look of native tabs** are not fully documented; verified on the emulator in step 1, reported if they fall short.
- **MMKV and Reanimated native modules** need a dev build rather than Expo Go; the Windows path-length workaround (repo at `C:\sa`, hoisted linker, CMake staging in `C:/b`) already in place applies.
- **Offline gazetteer size:** a few hundred KB compressed for Niš; measured, not assumed.
- **Contract drift** between app and server is caught by parsing every response with the shared schemas.

## Acceptance (from BRIEF §9)

- Android design QA screenshots in `docs/screens/android/` and the TalkBack checklist in `docs/qa-checklist.md`.
- The Maestro flow onboarding → add address → see outage → open detail passes on the local emulator.
- iOS paths compile (typecheck). The iPhone smoke build is Phase 6.
- The merged Android manifest has no calendar permission (checked by a test).
- Lint, typecheck and all tests green; summary, open issues, then a stop for review.
