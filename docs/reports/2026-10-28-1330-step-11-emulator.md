# Phase 3, step 11 (emulator part): Maestro design QA, and the phone session prepared

Date: 2026-10-28. Branch `main`. `2909f18` is pushed; after it, three commits are **not pushed**: `4cdb935` (labels, partial names), `792449e` (map zoom) and this step's commit. Stopped here, **before the phone session**, as asked.

## Maestro

Installed as you approved: Maestro **2.12.0**, from the release zip of `mobile-dev-inc/maestro` (350 MB; the zip is deleted, its entries were checked for unsafe paths before extracting), in **`C:\tools\maestro`**. Java 17 was already there. Your global PATH is **unchanged**: the scripts take `MAESTRO_BIN=C:/tools/maestro/bin/maestro.bat` (or `maestro` on the PATH if you add it). Nothing was uploaded: `MAESTRO_CLI_NO_ANALYTICS=1`, no cloud.

**Flows** (`.maestro/`, against the development mock API; the mock scenario is switched from inside a flow through a small script):

| flow | what it visits |
| --- | --- |
| `01-onboarding` | clean install; the three steps; street search; the confirm form; the first address saved; Početna |
| `02-home-scenarios` | Početna in `clear`, `upcoming`, `imminent`, `active`, `cancelled`, `possible`, `three`; `active` then `offline` (saved data and the offline notice); `fail` (every request answers 500) |
| `03-detail-and-actions` | the outage detail of an outage in progress: top, the map, the street list, the actions, the raw EDS text, and the system share sheet |
| `04-tabs-and-settings` | Najave (list, scrolled, search), Istorija, Podešavanja (four screens), the add-address sheet with a search |

**Driver:** `pnpm --filter @struja/scripts qa-screens [--configs ...] [--flows ...]`. For each of **four configurations** it sets the theme and the font scale with adb (light and dark, font 1.0 and 2.0), runs the flows and collects the screenshots; it puts the theme and the font back at the end. `MAESTRO_BIN` and `adb reverse tcp:8081` are the only setup besides Metro, the mock API and the debug build.

**Result: all four flows passed in all four configurations, 128 screenshots** (32 per configuration). Full-size working set in `docs/screens/android/step11/<config>/` (git-ignored, as before); the **final QA set is committed, compressed** (half size, JPEG 72, 7.5 MB) in **`docs/screens/android/qa/<config>/`**: `light-font1`, `dark-font1`, `light-font2`, `dark-font2`.

Things I had to find out and handle (they are in the flows and the driver): Maestro 2.12 only allows screenshots inside its output folder (`--test-output-dir`); the debug build must be opened with its Metro link (`openLink`), a plain launch cannot find the bundle; `launchApp` clears the data and grants the permissions (the Android 17 local-network prompt of the debug build); at 200 % the keyboard covers the results of the address search, so the flow hides it before choosing; after a failed step a stray swipe could pull down the notification shade and break every later flow, so the driver now collapses it and goes home before each flow.

## What the QA shows (and what it does not cover)

- **200 % and dark hold.** Every screen reads and scrolls at font 2.0 in both themes (the earlier step 8 fixes, and the new map button and credits, behave). The map is in both themes; the "Celo isključenje" pill and the credits wrap but stay legible.
- **A real finding:** at 200 % the **add-address search leaves room for one result** above the keyboard (the title and the three city chips take most of the screen); the list scrolls, so nothing is lost, but with a name like "Vojvode Putnika" the second result is hidden. Worth a fix: collapse the title and chips while typing at a large font. Not done: tell me if you want it.
- **The dev toast.** Some frames show "Open debugger to view warnings". It is the development build's "Looks like you have configured linking in multiple places" error, raised when Metro re-opens the running dev build (the known debug-only warning, step 8); a release build does not show it.
- **Not in the Maestro flows** (they are in the earlier adb screenshot sets, steps 4 to 8, and in the jest tests): the notifications-off banner, the house-number form, the delete-my-data confirmation, the empty Najave and Istorija, the first-launch states with a slow or failed gazetteer. The system actions that leave the app (calendar, "Otvori izvor", TalkBack) are for the phone.

## The phone session, prepared (not started)

- **`docs/phone-session.md`:** the setup (USB debugging, the commands to start the local stack with data for today, Metro bundled for the tunnel) and **your checklist: calendar, share, "Otvori izvor", the map, TalkBack**, each with what to look for and a box to tick.
- **`pnpm --filter @struja/scripts phone-session [--install]`:** checks that one phone (not an emulator) is attached and authorised, that the API and Metro answer, sets `adb reverse` for `:8081` and `:3000` (so the phone reaches the local server as `localhost:3000`), installs the APK, grants the debug build's local-network permission and opens the app.
- **The debug APK for the phone is built:** `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, **arm64-v8a only** (98.4 MB; it contains MapLibre; checked: no x86 libraries), built with `gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a` in 1 min 42 s (the build is rebuilt by the same command, it is not committed). The app reaches the API at `http://localhost:3000` when Metro is started with `EXPO_PUBLIC_API_URL=http://localhost:3000` (the debug build allows cleartext; a release build would need https: unchanged).
- Push is not part of the session (dev tokens: the server logs `push:not-sent`; real delivery is Phase 4).

## Gate

`pnpm lint` 0 warnings (the `.maestro` scripts get Maestro's globals in `eslint.config.mjs`) · `pnpm typecheck` green · `pnpm test` green. Tests: mobile **328** jest + 29 contract (6 live skip) · server **256** · parser **177** (174 + 3 todo) · shared 23 · scripts 62.

## Decisions needed

1. OK to push the three commits (`4cdb935`, `792449e`, this one)?
2. Fix the large-font add-address search (collapse the title and chips while typing)?
3. Start the phone session when you are ready: connect the phone and follow `docs/phone-session.md`; tell me when it is attached, or send the results.
