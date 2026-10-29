# Struja Alert — Implementation Plan (`docs/PLAN.md`)

## Context
BRIEF.md §0 asks for a plan before any code: architecture, folder tree, dependency list with **verified** versions, and the phase breakdown, with every Mac-only step marked **[MAC]**. All versions below were checked on 2026-10-22 against the npm registry, docs.expo.dev / expo.dev changelog, nodejs.org and Docker Hub. None come from memory.

This plan was finished in the previous session (2026-10-22, ~11:53), which ended before approval was requested. It is carried over unchanged except for the **Android toolchain**, which has been installed since then (re-verified below).

**On approval, the only actions are:** write this content to `docs/PLAN.md`, then `git add` + `git commit` ("Add implementation plan"). No code and no push. Then stop for review.

Decisions taken during planning:
- **Server isn't ready yet.** The Phase 1 collector runs on **GitHub Actions cron**. Phase 2 runs on the local Docker stack, reached from the phone via LAN or a Cloudflare quick tunnel. Existing proxy vs Caddy is decided once the server exists, before the Phase 2 deploy.
- Scraper User-Agent: `StrujaAlert/<version> (+mailto:${SCRAPER_CONTACT_EMAIL})`. The contact address is read from the `SCRAPER_CONTACT_EMAIL` env var (documented in `.env.example`, set as a GitHub Actions secret for the collector). The scraper refuses to run without it. No personal address is committed.

**Approved additions (user, after plan review):**
1. Phase 2 includes a minimal server-rendered admin page (admin token + IP allowlist): unresolved queue, one-click confirm/reject of candidates, spot-check list of auto-accepted matches.
2. Contact email comes from `SCRAPER_CONTACT_EMAIL` (above).
3. Collector accepts a one-hour window per slot and dedupes per slot (GitHub cron can be delayed). DST ends 25 Oct 2026.
4. Phase 3: before building the map, present Android map options (Google Maps key vs MapLibre + tile provider; cost and setup) and wait for the user's choice.
5. Phase 3 iOS smoke build needs a paid Apple Developer account. If it isn't ready, move that check to Phase 6 and tell the user.
6. Ask before installing Maestro (user: wait until Phase 3).
7a. Phase 3 (device secret, user 22 Oct): the app keeps its own list of saved addresses on the device. If the device secret is missing (reinstall, cleared storage), it registers again (`POST /v1/devices` takes over the push token) and re-adds its addresses; the in-app rule (an added address records the already published outages as told, nothing is pushed) means nothing is pushed twice.
7. `pnpm-workspace.yaml` has a `minimumReleaseAgeExclude` list (brand-new Expo packages). **Remove the exemptions once those versions pass the age threshold.**
8. Before the first Play build, block unneeded permissions in `app.json` (`android.blockedPermissions`): `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`. This is a Phase 5 item, not applied yet: `SYSTEM_ALERT_WINDOW` comes in for the dev-client overlay, and blocking it in the shared manifest could break debug builds, so apply it for the release profile (or verify debug still works). Also confirm the release manifest has no `ACCESS_LOCAL_NETWORK`.
9. Every test run writes JUnit and coverage reports to `test-results/` (git-ignored).
10. **The Phase 1 gate is measured on in-scope rows only** (Niš page + one of the five city municipalities), always with the sample size beside every number, and re-run weekly (`.github/workflows/gate-report.yml`, `pnpm --filter @struja/scripts gate-report`). **The scoring weights and thresholds (`packages/parser/data/scoring.ts`) stay provisional until the gate passes: they are frozen only after it passes and before the Phase 5 live run.** Phase 2 builds on them without treating them as final.
11. Failure classes for other areas (exclusion lists "осим насељених места", "Доња и Горња X", dot-joined names) are logged in `docs/failure-classes.md` with real fixtures; not handled now (scope is Niš only).

**Dev environment, re-verified 2026-10-22 (this session):**
- Present: Node 24.15.0, pnpm 12.14.0, eas-cli 25.3.0, Docker 29.8.2 + Compose v5.6.0, gh, OpenSSH, Git.
- Android: `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`; `adb` and `emulator` on PATH; platforms android-36, 36.1, 37.0; build-tools 36.0.0; AVDs `Pixel_10_Pro` and `Medium_Phone_API_37.0` (both `google_apis_playstore` x86_64, API 37); `emulator-5554` running. JDK: `JAVA_HOME` = Microsoft OpenJDK 17.0.20.
- **Missing:** Maestro CLI. There's also no NDK, which Gradle installs on the first `expo run:android`. Phase 0 checks that JDK 17 meets the SDK 58 / RN 0.88 Gradle requirement and switches to the Android Studio JBR if it doesn't.

---

## 1. Where reality differs from the brief (flagged per §0)
| # | Brief assumes | Reality (verified) | Plan |
|---|---|---|---|
| 1 | Maestro installed alongside the Android tools | Android SDK, adb, emulator (Play image) and JDK are present; **Maestro is missing** | Install Maestro CLI 2.11.0 in Phase 0, then verify |
| 2 | "Latest TypeScript" | TS 7.0.2 is `latest` (Go-native), but typescript-eslint 8.72 needs TS `<6.1` | Pin **typescript ~6.0.3**; revisit when typescript-eslint supports 7 |
| 3 | Drizzle latest | 1.0 is still RC (1.0.0-rc.5) | Pin stable **drizzle-orm 0.45.4 / drizzle-kit 0.31.11** |
| 4 | Glance widget via own plugin or a library | **expo-widgets 58 supports Android (Glance)**, but has no timelines and only a subset of components | Use expo-widgets on both platforms. State boundaries are driven by data pushes + `updateSnapshot` (see §5 risks) |
| 5 | Live Update via a small Expo module | Confirmed: nothing in Expo/community exposes `ProgressStyle` / promoted notifications | Custom local Expo module `live-update` (Kotlin) |
| 6 | Native tabs = Material 3 bottom nav + predictive back | Native tabs are **stable in SDK 58** (`expo-router/native-tabs`), but M3 styling isn't documented, and predictive back is opt-in (`android.predictiveBackGestureEnabled`, default false) | Enable the flag; verify look and back behaviour on the emulator in Phase 0/3; report if it falls short |
| 7 | Parser runs unchanged in Node and Hermes | `iconv-lite` needs `Buffer`; Hermes `TextDecoder` has no windows-1251 | Own pure-TS windows-1251 table + encoding detection in `packages/parser` |
| 8 | Maestro on EAS for iOS | EAS `type: maestro` job is **alpha** | Use it for the iOS smoke run; local emulator stays primary |

## 2. Architecture
```
EDS .htm ──(collector: GH Actions cron, Phase 1)──▶ fixtures/ (git)
EDS .htm ──(prod scheduler 07/13/19 Europe/Belgrade)──▶ server
server: fetch(ETag/Last-Modified) → hash → parse (packages/parser) → split Ulice
        → resolve ladder (exact → alias → pg_trgm fuzzy → heuristics → PostGIS-scored → unresolved)
        → persist (outage / outage_street, identity_key) → match subscriptions
        → notify (expo-server-sdk; notification_log UNIQUE dedupe) → receipts job
        → monitoring alerts (email + admin push)
app ◀── /v1 REST (zod schemas from packages/shared), device-secret auth
app: Expo Router native tabs, TanStack Query + MMKV persisted cache (offline-first),
     Zustand settings, local gazetteer search via packages/parser normalizer
Android extras: expo-widgets (Glance), live-update module, headless data-push task
iOS extras [MAC]: expo-widgets widgets + Live Activity (push-to-start), expo-glass-effect
```
- `packages/parser`: pure TS with zero I/O. Contains the encoding detection + cp1251 decoder, HTML table extraction (htmlparser2), date/time parsing (Europe/Belgrade → UTC), Ulice splitter, normalizer, abbreviation data file, house-range parser, heuristic variants, a Jaro-Winkler implementation (~30 lines, own code), a scoring feature/score function (weights JSON) and transliteration. It is used by the server, the app (search + sr-Cyrl generation) and the scripts.
- `packages/shared`: zod 4 schemas for every API request/response, enums (statuses, notification kinds, resolved_by), constants (MAX_ADDRESSES=3, quiet hours defaults, poll times).
- Server-side spatial and trigram work stays in Postgres (pg_trgm `similarity`, PostGIS `ST_Distance`). The pure scorer in `packages/parser` takes the precomputed features, so the same scorer runs in Vitest on fixtures.
- Outage identity key = city + municipality + date + sorted normalized street set, with the time window excluded. This classifies `changed` vs `cancelled` (two consecutive missing runs, future date only).
- Auth: `POST /devices` returns a random secret. The server stores a scrypt hash (Node `crypto.scrypt`, no extra dependency). The app keeps the secret in expo-secure-store.
- Admin: bearer admin token plus an IP allowlist, enforced in Fastify and at the proxy.

## 3. Folder tree
```
.claude/settings.json
.github/workflows/ci.yml            lint · typecheck · test on push
.github/workflows/collect.yml       Phase 1 fixture collector (cron)
.eas/workflows/release-android.yml  on tag v* → build → submit Play internal
.gitattributes  .gitignore  .env.example  .nvmrc  .prettierrc
CLAUDE.md  README.md  turbo.json  pnpm-workspace.yaml  package.json  eslint.config.mjs  tsconfig.base.json
apps/
  mobile/
    app.config.ts  eas.json  metro.config.js
    app/                     Expo Router: (tabs)/{index,najave,istorija,podesavanja}, onboarding/, address-sheet, outage/[id]
    src/design/              tokens (color/type/spacing/radius/motion, per-platform), StatusHero, MeshBackground, DayStrip,
                             AddressCard, TimelineBar, RangeChips, CountdownText, Banner, EmptyState, SkeletonCard, SectionHeader
    src/api/  src/store/  src/i18n/ (sr-Latn source, sr-Cyrl generated + overrides, en)  src/notifications/  src/widgets/
    modules/live-update/     local Expo module (Kotlin; iOS no-op stub)
    maestro/                 E2E flows + mock server setup
  server/
    src/{app.ts, routes/v1/*, routes/admin/*, jobs/*, ingest/*, resolve/*, match/*, notify/*, monitor/*, db/schema.ts}
    drizzle/                 checked-in migrations (incl. CREATE EXTENSION postgis, pg_trgm)
    test/                    Testcontainers integration tests, fixture replay
    Dockerfile
packages/
  parser/  src/ · data/abbreviations.json · data/aliases.json (Phase 1) · test/
  shared/  src/schemas/* · src/constants.ts
scripts/                     TS tooling: collect-fixtures.ts, seed-gazetteer.ts (Overpass), label-sample.ts, android-qa.ts (adb settings)
fixtures/                    raw EDS HTML (+ meta JSON: url, fetched_at, headers, detected encoding), osm/ seed snapshot, labels.csv
docker/                      compose.yaml (local), compose.prod.yaml, Caddyfile (profile, optional)
docs/                        PLAN.md, phase1-report.md, ops.md, qa-checklist.md, screens/android/, screens/ios/, privacy.md, store/
```

## 4. Dependencies (verified 2026-10-22)
**Runtime / tooling:** Node **24 LTS** (latest 24.22.1; installed 24.15.0, fine for SDK 58 which needs ≥24.3; Node 26 becomes Active LTS 2026-10-28, revisit after Phase 2) · pnpm 12.14.0 (installed) · turbo 2.11.10 · typescript ~6.0.3 · eslint 10.13.0 (flat config) · typescript-eslint 8.72.0 · prettier 3.9.10 · eas-cli 25.3.0 (installed) · Maestro CLI 2.11.0 · Docker 29.8 (installed).

**Server:** fastify 5.12.7 · @fastify/cors 11.3.1 · @fastify/rate-limit 11.2.1 · @fastify/helmet 13.2.0 · fastify-type-provider-zod 7.0.0 (needs zod ≥4.2) · zod 4.6.7 · drizzle-orm 0.45.4 · drizzle-kit 0.31.11 · pg 8.23.1 (shared with pg-boss) · pg-boss 12.38.0 (cron with `tz: 'Europe/Belgrade'`) · expo-server-sdk 7.2.0 (receipts polled by a delayed job, up to 30 min) · pino 10.4.0 · pino-pretty 13.2.0.
**DB/infra images:** `postgis/postgis:18-3.6` (PG 18.6 + PostGIS 3.6.4; pg_trgm in contrib) · `caddy:2.11` (only if no existing proxy).
**Parser:** htmlparser2 12.0.0 (pure JS; Hermes smoke check in Phase 1), own cp1251 table, own Jaro-Winkler.
**Tests:** vitest 5.0.5 · testcontainers / @testcontainers/postgresql 12.2.1 · jest-expo 58.0.12 · @testing-library/react-native 14.1.0 (+ `test-renderer` peer).

**Mobile — Expo SDK 58** (expo 58.0.17, React Native 0.88, React 19.3.0, New Architecture always on, edge-to-edge mandatory). Every Expo package goes through `npx expo install`, so SDK-pinned versions win:
expo-router ~58.0.24 (native tabs stable) · expo-symbols ~58.0.4 (Material Symbols on Android, so no bundled font) · @expo/ui ~58.0.21 (Compose Material 3 components) · expo-widgets ~58.0.21 · expo-glass-effect ~58.0.4 · expo-blur ~58.0.5 · expo-notifications ~58.1.5 · expo-task-manager ~58.0.12 · expo-maps ~58.0.10 (Google Maps API key on Android) · expo-calendar ~58.0.6 (new API) · expo-haptics ~58.0.7 · expo-secure-store ~58.0.2 · expo-localization ~58.0.5 · react-native-reanimated 4.7.1 + react-native-worklets 0.13.0 · react-native-gesture-handler (SDK pin ~3.3.0, v3) · @tanstack/react-query 5.104.5 + @tanstack/react-query-persist-client 5.104.5 · react-native-mmkv 4.3.2 + react-native-nitro-modules (MMKV-backed persister) · zustand 5.0.16 · i18next 26.5.5 · react-i18next 17.1.1.

## 5. Key technical risks (verify early, report if they fail)
- **Data-only push when killed** (Android): headless `TaskManager` task. Doze or force-stop may block it. Verify in Phase 4; fall back to direct FCM high-priority data message for the "active" signal.
- **Widget state changes without opening the app:** expo-widgets on Android has no timelines. Plan: server data pushes at imminent (−24 h), `starts_at` and `ends_at` call `updateSnapshot` in the headless task, plus a refresh on each app data sync. Verify in Phase 4.
- **Live Update:** `live-update` module, using `Notification.ProgressStyle` + `setRequestPromotedOngoing` on API 36+ (needs `POST_PROMOTED_NOTIFICATIONS`). Below 36, an ongoing notification with a countdown chronometer (`setUsesChronometer` + `setChronometerCountDown`). The API 37 emulator covers the promoted path; the fallback path needs an older image or the physical phone.
- **Material 3 Expressive + dynamic color:** @expo/ui gives the M3 components. Dynamic-color access for custom RN surfaces gets checked in Phase 0. If unavailable, the `live-update` module (renamed `android-platform`) exposes the system dynamic palette.
- **Resolution rate ≥95% and auto-accept precision ≥99%:** the Phase 1 gate. Unknown until the corpus exists.

## 6. Phases (each ends with all checks + summary + open issues + **stop for review**)
**Phase 0 — Scaffold**
1. Toolchain: install Maestro CLI 2.11.0 (user, or me with approval). Verify `adb devices`, `emulator -list-avds`, `java -version` (JDK 17 vs SDK 58 requirement) and `maestro --version`.
2. Monorepo: pnpm workspaces, turbo, tsconfig strict base, ESLint flat + Prettier, `.gitattributes` (`* text=auto eol=lf`), `.gitignore`, `.env.example`, `.nvmrc`.
3. `CLAUDE.md` (conventions, commands, §8 non-negotiables), `.claude/settings.json` (allow: pnpm, node, `npx expo …`, adb, `maestro test`, read-only git, git add/commit, docker compose; ask: git push, ssh/scp, eas build/submit/workflow:run, deploys, prod server).
4. Empty `packages/parser` + `packages/shared` with one passing Vitest each. Fastify `/healthz` stub. `docker/compose.yaml` with PostGIS 18-3.6.
5. Expo SDK 58 app shell with native tabs (4 tabs, placeholders), predictive back enabled, dark mode, runs via `npx expo run:android`.
6. GitHub Actions CI (lint, typecheck, test).
✅ `pnpm lint && pnpm typecheck && pnpm test` green on a clean clone. The shell launches on the emulator.

**Phase 1 — Data spike (no app code)**
1. **First:** `scripts/collect-fixtures.ts` + `.github/workflows/collect.yml`. It checks robots.txt, discovers city slugs from the EDS index and probes `Dan_N` for the max N, then saves raw bytes + meta to `fixtures/`, committing to branch `fixtures-collect`. Cron entries at 05,06,11,12,17,18 UTC. Each of the three slots (07:00, 13:00, 19:00 Europe/Belgrade) has a **one-hour window**: a run whose Belgrade local time falls in `[slot, slot+1h)` collects, which tolerates delayed GitHub cron. Dedupe is per slot (`YYYY-MM-DD-slot` marker in `fixtures/`), so a late or doubled run never collects twice, and the script still handles DST (ends 25 Oct 2026). The same script later runs from server cron. Before enabling the workflow I show it to the user, since it pushes on a schedule.
2. `scripts/seed-gazetteer.ts`: one Overpass query (Niš admin area, named highways + address points, polite UA, `[timeout:180]`), saved under `fixtures/osm/` and loaded into local Postgres.
3. Parser, normalizer, range parser, ladder steps 1–5 prototype (scoring with hand weights), fixture-driven Vitest.
4. `packages/parser/data/aliases.json`, `fixtures/labels.csv` (~200 segments with proposed answers), `docs/phase1-report.md`, answers to the §10 open questions.
🚧 GATE: ≥95% automatic resolution, ≥99% auto-accept precision, all failure classes understood. **Stop and report.**

**Phase 2 — Backend:** Drizzle schema + migrations (§4 model; `notification_log` UNIQUE), pg-boss jobs (scrape 07/13/19, reminders 19:15, start/end triggers, receipts, nightly weight refit + pg_dump), full `/v1` API + admin, monitoring alerts, Testcontainers tests, fixture replay → expected deduped notifications. Testing runs on the local stack with curl + a seeded fake subscription. Deployment: compose.prod (own network, own DB volume, CPU/mem limits, restart policies, log rotation), `docs/ops.md` with backup/restore test. **The proxy-vs-Caddy decision and the deploy itself wait for the server (ask before any ssh/deploy).**

**Phase 3 — Design system + app (Android first):** tokens and components, every §6 screen against zod-mocked API, then the real API; i18n (sr-Cyrl generated via transliteration); all states; a11y. Android design QA: Maestro screenshots light/dark × font 1.0/2.0 → `docs/screens/android/`, `docs/qa-checklist.md` (TalkBack). iOS paths compile; iOS polish stubbed **[MAC]**. Propose one **EAS iOS dev build** for the iPhone smoke test (runs only after approval).
✅ Screenshots + checklist exist; Maestro onboarding → add address → outage → detail passes locally; iOS dev build launches.

**Phase 4 — Android notifications, widget, Live Update:** 4 kinds + "Hitno" channel, actions (Detalji, Dodaj u kalendar), grouping, quiet hours, deep links, calendar export, expo-widgets small/medium, `live-update` module + fallback, data-push verification. Plus an iOS smoke build proposal. ✅ Each kind verified on the physical Android phone.

**Phase 5 — Harden + Play internal:** change/cancel fixture sequences, Kraljevo smoke test, the real app icon before the first Play build (bolt glyph per BRIEF §7: SVG source, Android adaptive foreground + background layers and the monochrome layer for themed icons; the notification small icon stays the white bolt), EAS workflow on tag → build → submit internal track, Play listing sr/en + Data safety, privacy policy, closed-testing reminder if the account is personal. ✅ 30-day Android live run starts (needs the real server).

**Phase 6 — iOS [MAC]** (all steps **[MAC]**): Liquid Glass (GlassView/GlassContainer, blur fallback, Reduce Transparency), SF Symbols, sheets with detents, glass tab bar; expo-widgets iOS (systemSmall/Medium, accessoryRectangular/Circular, timeline entries) + Live Activity with push-to-start and server token tracking; Icon Composer icon; time-sensitive capability; iOS push verification; simulator design QA → `docs/screens/ios/` + VoiceOver checklist; TestFlight; App Store metadata. Note: SDK 58 needs Xcode 26.4+ (some features need Xcode 27).

## 7. Verification of this planning step
- `docs/PLAN.md` exists with the content above and is committed. `git status` is clean, and no code files were created.
- The user reviews it and approves before Phase 0 starts.
