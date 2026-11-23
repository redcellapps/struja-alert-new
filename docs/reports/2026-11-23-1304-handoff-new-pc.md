# Handoff to a new PC (23 Nov 2026)

Requested: push `504f334`, commit the uncommitted widget work to `wip/widget` and push it, write `docs/setup-new-pc.md` on main and push it, list what is not on GitHub. Done; stopped here.

## Commits and pushes

| Branch       | Commit                      | What                                                                                                                                                     | Pushed |
| ------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `main`       | `504f334`                   | Report: watchdog fix and the 31 Oct 07 slot (approved push)                                                                                              | yes    |
| `wip/widget` | `0bd1942` (on `504f334`)    | WIP Phase 4 step 4: the Android widget, as-is. Commit message says it is unfinished and that lint, typecheck and tests were not run for it and may fail. | yes    |
| `main`       | the commit with this report | `docs/setup-new-pc.md` and this report                                                                                                                   | yes    |

`main` does not contain the widget work. The working tree of the old PC is clean on `main`. No stashes, no other local branches, no unpushed commits.

`wip/widget` holds: the module `apps/mobile/modules/struja-widget` (Kotlin, Glance), `src/widget/`, the wiring in the alarms, push task, 15-minute refresh and delete-data, `widget.*` i18n keys, `__tests__/widget.test.ts`, `docs/widget.md`, decision 16 in `docs/phase4-plan.md`, the CLAUDE.md layout line, and 25 uncompressed screenshots in `docs/screens/android/phase4/` (about 34 MB in that folder).

## Tests

Not run in this step (nothing in the code changed on `main`; the widget commit was made as-is on request). Last known state of the widget work (30 Oct): jest 395 passing in the app, typecheck and lint green; full `pnpm test` not run on it.

## `docs/setup-new-pc.md`

Covers: exact versions (Node 24.15.0, pnpm 12.14.0, Microsoft OpenJDK 17.0.20.1, Android Studio 2026.2, SDK packages with build-tools 37.0.0 / NDK 27.1.12297006 / CMake 3.22.1 / platforms 37.0 and 36, AVD `Pixel_10_Pro` on API 37 Google Play x86_64 with 2 GB RAM, Docker Desktop 4.95.0, gh 2.103.0, Maestro 2.12.0, eas-cli); the git-ignored files and where each comes from; `.wslconfig` (4 GB) and the Gradle/Kotlin caps; clone to app on the emulator and on the phone against the local server; Claude Code's memory and settings and how to copy them.

## Decisions / things to know

1. **eas-cli version mismatch on the old PC:** installed 25.3.0, but `apps/mobile/eas.json` requires `>= 27.1.0`. The doc says to install the current eas-cli on the new PC. Not needed for local dev, only for EAS builds.
2. **Debug signing:** a new PC generates `apps/mobile/android/app/debug.keystore` at prebuild. If installing over the app already on the phone fails with a signature error, copy that file from the old PC or uninstall the app first (it loses its saved addresses). The doc says so.
3. **Claude memory:** the note `widget-step4-in-progress.md` was updated to point at `wip/widget` / `0bd1942`. Copy `C:\Users\<you>\.claude\projects\C--sa\memory\` to the new PC (same repo path `C:\sa` keeps the folder name).

## What is NOT on GitHub after this

Needed on the new PC (copy over a private channel or recreate; section 4 of the doc):

- `.env` (repo root): secrets (`ADMIN_TOKEN`, `EXPO_ACCESS_TOKEN`, `SCRAPER_CONTACT_EMAIL`) plus `DATABASE_URL`, `ADMIN_IP_ALLOWLIST`.
- `apps/mobile/google-services.json` (Firebase console or copy).
- Claude Code state: `C:\Users\<you>\.claude\projects\C--sa\memory\` (2 notes + `MEMORY.md`), optionally the session transcripts there, `~\.claude\settings.json` and `settings.local.json`. Not the login file.

Machine setup, not files to carry (all written into the doc): `~\.wslconfig`, the AVD, the Android SDK, `C:\tools\maestro`, the phone's USB-debugging authorisation (the new PC has a new adb key, the phone asks again).

Lost unless copied, and not needed:

- Local Postgres data (Docker volume `dbdata`): rebuilt by migrations, gazetteer import and `dev:scrape`; the phone's subscriptions register again.
- `.dev/eds/` and the `.dev-*.log` files (rebuilt by `dev:fixtures`).
- Generated `apps/mobile/android/` (including `debug.keystore`, see above), `node_modules`, `.turbo`, `test-results/`, the widget module's `android/build/`.
- Working screenshots, git-ignored by design: `docs/screens/android/step4`, `step6` to `step11`, `step10b`, `design-review`, `design-review-v2` (about 116 MB). Only the final QA set is committed.

Elsewhere and unaffected: the `fixtures-collect` branch and the hourly collector on GitHub Actions (secret `SCRAPER_CONTACT_EMAIL` in the repo settings), EAS credentials (FCM key) on expo.dev.
