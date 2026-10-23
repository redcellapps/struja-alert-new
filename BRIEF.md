# Struja Alert — Claude Code Build Brief

You are building **Struja Alert** (final app name), a mobile app for **Android and iOS** from one Expo codebase. It sends a push notification when a planned electricity outage (planirano isključenje struje) is announced for one of the user's saved addresses in Serbia. It starts with Niš only, but the code must not depend on any one city.

**Platform order: Android first, then iOS.**
- We build and test on Android on Windows first.
- iOS-specific work comes in a later phase, when a Mac with Xcode joins (§9, Phase 6).
- It is one app with shared code, not a port. Every screen, data path and component is written to work on both platforms from day one. Only the iOS-specific native polish waits for the Mac.

Build the full product as specified here. This is not a throwaway prototype.
- The first Android build goes to the Google Play **internal testing** track.
- The first iOS build goes to **TestFlight** (internal).
- The public store releases come later through the same pipelines.

---

## 0. How to work

- Read this whole brief first. Then use plan mode to write `docs/PLAN.md`. It should contain the architecture, the folder tree, the dependency list with versions you verified, and the phase breakdown. **Wait for my approval before writing code.**
- Work strictly phase by phase (§9). At the end of each phase, run every check, summarize what you did, list open issues, and **stop for my review**.
- **Never pin library versions from memory.** Check the current official docs for Expo, Expo Router, expo-widgets, expo-glass-effect, Drizzle, Fastify and the rest, and use the latest stable releases. Install Expo packages with `npx expo install`.
- During development, parse **saved fixtures, not the live site**. Only two things may request elektrodistribucija.rs: the fixture collector script and the production scheduler.
- Create `CLAUDE.md` at the repo root with conventions, commands and the non-negotiables from §8, and keep it up to date.
- If reality contradicts this brief (for example, the EDS markup is different, or a library this brief names does not support what is needed), **stop and tell me**. Do not guess.

### Development environment
- **The dev machine is Windows.** I run you in the VS Code integrated terminal.
  - Installed: Git, Node 24, npm, pnpm, Docker Desktop, GitHub CLI, EAS CLI, OpenSSH, Android Studio (Android SDK + emulator).
  - In Phase 0, verify that `ANDROID_HOME`, `adb` and an emulator with a Google Play system image are available, and tell me exactly what is missing.
- **Android is the primary dev and test target until the Mac arrives.**
  - Run development builds locally with `npx expo run:android`, on the emulator and on my physical Android phone.
  - Run Maestro E2E flows locally against the Android emulator.
- **iOS before the Mac:**
  - Keep iOS code paths compiling.
  - Once per phase from Phase 3 on, propose one EAS development build for my iPhone as a smoke test, so iOS surprises show up early. It runs only after I approve it.
- **Mac steps:** in `docs/PLAN.md`, mark every step that needs the Mac as **[MAC]**. These include Liquid Glass polish, iOS widgets and Live Activity, Icon Composer, simulator QA and Xcode debugging. Do the Windows work around them. When you reach a [MAC] step, stop and tell me.
- **Keep the repo platform-neutral**, so a fresh clone on the Mac runs with `pnpm install` and the commands in `CLAUDE.md`.
- **All scripts must work on Windows and macOS.** Use no bash-only syntax in `package.json`. Write tooling scripts in TypeScript/Node. Add `.gitattributes` to enforce LF line endings.
- **Claude Code permissions:** in Phase 0, create `.claude/settings.json`.
  - **Allowed without asking:** `pnpm`, `node`, `npx expo` (including `run:android`), `adb`, `maestro test`, read-only `git` commands, `git add` / `git commit`, and `docker compose` for the local stack
  - **Always ask first:** `git push`, `ssh`/`scp`, `eas build`, `eas submit`, `eas workflow:run`, any deploy, and anything that touches the production server
- Never commit secrets. `.env` is git-ignored, and `.env.example` documents every variable. `google-services.json` and other credential files are git-ignored, and EAS handles them as file secrets.

---

## 1. Tech stack

**Monorepo:** pnpm workspaces + Turborepo, TypeScript `strict` everywhere, ESLint, Prettier.

```
apps/
  mobile/        Expo (latest stable SDK), Expo Router, Android + iOS
  server/        Node LTS, Fastify, Drizzle ORM, Postgres
packages/
  parser/        PURE TypeScript, zero I/O deps: page parser, Ulice splitter,
                 normalizer, house-range parser, matcher, transliteration
  shared/        zod schemas for every API contract, shared types, constants
fixtures/        raw EDS HTML pages collected in Phase 1 (committed)
docs/
```

- `packages/parser` must run unchanged in Node, on the server and in the app. No fetch, no fs, no DB.
- **Server:**
  - Fastify, Drizzle (migrations checked in), Postgres 16+ with `pg_trgm` and PostGIS, pg-boss (or equivalent) for scheduled jobs, `expo-server-sdk` for push, pino logging
  - **No external or paid AI/LLM APIs anywhere in the running system** (see §8)
  - Docker Compose for both local and production
  - Production target: our own dedicated Linux server, which also runs other internal services (see §4 Deployment)
- **Mobile, shared:** Expo Router with native tabs, Reanimated, `expo-haptics`, `expo-notifications`, `expo-calendar`, `expo-maps`, `expo-secure-store`, `expo-localization` + i18next. Use TanStack Query with a persisted cache (MMKV) for offline-first data, and Zustand for local settings.
- **Mobile, Android-specific:**
  - Our own flat design system (§7): an embedded font, one lime accent, solid fills. No Material You dynamic colour.
  - Material Symbols Rounded (filled), bundled as an embedded font: `expo-symbols` on Android only ships the regular outlined style.
  - A home screen widget built with Jetpack Glance through an Expo config plugin and a small Expo module, or a maintained library if one fits. Verify the options and propose one in the plan.
  - A **Live Update** (Android 16+ promoted ongoing notification with progress) during an active outage, through a small Expo module. Older Android falls back to an ongoing notification with a countdown chronometer.
- **Mobile, iOS-specific ([MAC] polish):** `expo-glass-effect`, SF Symbols via `expo-symbols`, and `expo-widgets` for home/lock screen widgets and the Live Activity.
- **Tests:**
  - Vitest for parser/matcher (fixture-driven)
  - Server integration tests against a real Postgres (Testcontainers)
  - React Native Testing Library for components
  - Maestro for E2E: run locally on the Android emulator. For iOS, use EAS Workflows (cloud simulator) until the Mac arrives, then the local simulator.
- **CI:**
  - GitHub Actions: lint, typecheck and test on every push
  - EAS Workflows: on tag, build Android and submit it to the Play internal track. After Phase 6, also build iOS and submit it to TestFlight.

---

## 2. Data source: Elektrodistribucija Srbije (EDS)

Static `.htm` pages with no JS and no auth. The Cyrillic text may be Windows-1251 or UTF-8, so detect the real encoding and do not trust the declared one.

```
Serbia (non-Belgrade):
https://elektrodistribucija.rs/planirana-iskljucenja-srbija/{City}_Dan_{N}_Iskljucenja.htm
Belgrade:
https://elektrodistribucija.rs/planirana-iskljucenja-beograd/Dan_{N}_Iskljucenja.htm
```

- `{N}`: 0 = today, through at least 3. Confirm the upper bound empirically.
- `{City}` slugs confirmed so far: `Nis`, `Kraljevo`. Discover the full slug list from the EDS outage index page.
- A page with only the header row is **valid data** (no outages), not an error.

**Table columns:** `Ogranak | Opština | Vreme | Ulice`. Belgrade pages omit `Ogranak`.

- `Vreme` looks like `08:30 - 12:30`. Times are Europe/Belgrade. Store them as `timestamptz`.
- The date is in the page header, e.g. `НИШ - Планирана искључења за датум: 09.08.2026.` Belgrade has also been seen with ISO `2026-08-10`. Parse both.
- `Ulice` is a comma-separated list of segments. Each segment is one of:
  - `STREET NAME: <ranges>`, where ranges are `N`, `N-M` or `N-MX`, and X is a Cyrillic letter suffix (`26-32В`, `35В`)
  - `Насеље <NAME>: <streets or ranges>`, a neighbourhood block
  - `Део села <NAME>`, part of a village with no street detail
  - A bare street name with no ranges, meaning the entire street

**Politeness:** use a `User-Agent` that names the app and gives a contact email. Check robots.txt before the first run. Poll at most 3× a day (07:00, 13:00, 19:00 Europe/Belgrade). Use ETag/Last-Modified caching and skip parsing when nothing changed. Credit EDS as the source in the app UI.

---

## 3. Parsing, normalization and address resolution

### Normalization (`name_norm`)
Apply these steps in this exact order, to gazetteer entries and scraped segments alike:
1. Serbian Cyrillic → Latin (`љ→lj, њ→nj, џ→dž, ђ→đ, ћ→ć, ч→č, ш→š, ж→ž`, …)
2. Lowercase
3. Strip diacritics (`đ→dj, ć→c, č→c, š→s, ž→z`)
4. Expand abbreviations: `bul.→bulevar`, `ul.→""`, `br.→""`, `nas.→naselje`, `gen.→general`, `dr→doktor`, `sv.→sveti`. Keep this list in a data file so it can grow.
5. Drop a leading `ulica`
6. Collapse whitespace and punctuation to single spaces, then trim

Example: `ВОЈВОДЕ МИШИЋА` → `vojvode misica`

### Gazetteer
Seed the canonical street list for Niš from OpenStreetMap (Overpass API: named `highway` ways inside the Niš admin area, with geometry). Deduplicate by `name_norm`. Store Latin name, Cyrillic name, municipality and the LineString geometry.

Also import OSM address points (`addr:street` + `addr:housenumber`) into `address_point`. They feed the scoring in step 5 below. They are optional data: a missing address point never blocks a match.

### Resolution ladder (fully automatic, no external AI, stop at the first hit)
1. **Exact**: `name_norm` equals `street.name_norm`
2. **Alias**: the segment's normalized raw text matches a `street_alias.raw_norm`
3. **Fuzzy**: `pg_trgm` similarity ≥ 0.85, against streets in the row's municipality first, then the whole city. On a hit, write an alias with `source='fuzzy'`
4. **Heuristic variants**, in pure code inside `packages/parser`. Try deterministic rewrites of the segment:
   - a missing first name or title (`МИШИЋА` → `Војводе Мишића`)
   - swapped word order (`ПАШИЋА НИКОЛЕ` → `Николе Пашића`)
   - dates written as numbers or words (`12. ФЕБРУАРА` ↔ `Дванаестог фебруара`)
   - stray `бб` / `б.б.`
   - **token-set containment**: every token of the segment appears in exactly one gazetteer street

   Accept **only if exactly one street matches**. Write an alias with `source='heuristic'` and confidence 0.8. If several streets match, the segment goes on to step 5.
5. **Candidate scoring with spatial context.** This step replaces an AI model. It applies to every segment that is still open, either with no match or with several possible streets.
   - **Candidates:** up to 10 gazetteer streets with trigram similarity ≥ 0.5, preferring the row's municipality.
   - **Score each candidate on:**
     - string similarity: trigram, Jaro-Winkler, and edit distance on the distinctive token (usually the surname)
     - whether it is in the same municipality as the EDS row
     - **distance to the other streets already resolved in the same EDS row** (PostGIS). One row is one area fed by the same substation, so the right street is almost always next to the others. This is the strongest signal.
     - whether the row's house numbers exist on that street in the OSM address data (`address_point`)
   - **Auto-accept** only when the top score is above the threshold **and** clearly ahead of the second candidate (a minimum margin). Write an alias with `source='scored'` and the score as its confidence.
   - **Weights:** they start hand-tuned. Once about 200 confirmed examples exist, a nightly job fits the weights on them (logistic regression or a small gradient-boosted model in plain TypeScript, saved as a weights JSON file). Every admin confirmation or correction becomes a new training example, so the matcher improves with use.
   - **Threshold:** tune it on the labeled sample from Phase 1 so that auto-accepts are **≥ 99% correct**. A wrong auto-match means a false alarm on one street and a missed outage on another.
   - **Spot-check:** recent `scored` auto-accepts are listed in admin. Rejecting one marks the alias wrong, re-runs matching and adds a training example.
6. **Unresolved**: store with `street_id = NULL` and save the top 5 candidates with their scores on the row. The segment goes to the **admin review queue**, and I get an immediate alert (§4 Monitoring).
   - Confirming a candidate in admin creates a `manual` alias (confidence 1.0) and **re-runs matching** for every affected future outage. Subscribers are then notified as usual.
   - **Safety net:** if a segment is still unresolved 12 h before the outage starts, notify subscribers whose street is among its candidates with similarity ≥ 0.6, labeled "Moguće pogođeno". This follows the false-positive bias below.

The automatic resolution rate (steps 1–5) is the key metric. If it is below 95%, invest in the alias map, the heuristics and the scoring features.

**Optional, only with my approval after Phase 1:** if steps 1–5 still fall short, propose a small open-weights model self-hosted on our own server (e.g. through llama.cpp or Ollama) as a final automatic step. It may only pick from the candidate list or return null, with JSON-constrained output, and it may never call an external API. Do not build this unless I approve it.

**Alias seed:** Phase 1 produces `packages/parser/data/aliases.json` from the collected corpus. I review it, and it is committed as data. The alias map grows only through the `fuzzy`, `heuristic`, `scored` and `manual` sources.

### House ranges
- `26-32В` → `house_from=26, house_to=32, house_raw='26-32В'`
- `35В` → `house_from=house_to=35`
- No range → the whole street (`NULL`/`NULL`)
- `parne`/`neparne`, if they appear → set `parity`

### Matching rule
A subscription matches if the street matches AND (`house_from IS NULL` OR the user's number is in `[house_from, house_to]`, respecting parity). If the user gave no house number, match on the street alone and label the result **"Moguće pogođeno"** (possibly affected).

**Prefer false positives to false negatives.** A missed outage destroys trust. An extra warning is a minor annoyance.

---

## 4. Backend

### Data model (Drizzle, Postgres)
- `street`: id, city, municipality, name_latin, name_cyrillic, name_norm, geom (LineString). `UNIQUE(city, name_norm)`
- `address_point`: street_id, housenumber, geom (Point), from OSM
- `street_alias`: street_id, raw, raw_norm, confidence (1.0 = human-confirmed), source (`exact|fuzzy|heuristic|scored|manual`), reviewed_at, rejected. `UNIQUE(raw_norm)`
- `scrape_run`: id, started_at, finished_at, url, http_status, etag, rows_found, error
- `outage`: source_url, content_hash, **identity_key**, city, branch, municipality, outage_date, starts_at, ends_at, raw_streets (the untouched Ulice cell, always kept), first_seen_run, last_seen_run, missing_runs, status (`active|changed|cancelled`), **revision** (integer, 0 at first; goes up only when the outage really changes state again: a cancellation, an undone cancellation, a reverted change), superseded_by_outage_id and change_group_id (which old row a new row replaced; ambiguous changes share a group). `UNIQUE(content_hash)`
- `outage_street`: outage_id, street_id (nullable), raw_segment, house_from, house_to, house_raw, parity, resolved_by (`exact|alias|fuzzy|heuristic|scored|manual|unresolved`), score, candidates (jsonb, top 5 with scores)
- `device`: push_token (unique), device_secret_hash, platform (`android|ios`), os_version, locale, script (`latn|cyrl`), quiet_hours, enabled_kinds, created_at, last_seen_at
- `subscription`: device_id, street_id, house_number, house_suffix, label, is_primary
- `notification_log`: subscription_id, outage_id, kind, **revision**, status (`pending|sending|sent|failed|suppressed|in_app`). **`UNIQUE(subscription_id, outage_id, kind, revision)` is the dedupe guarantee and must never be dropped.** The revision is the outage's revision at planning time (0 for `new` and `evening_before`), so every real flip is told (A→B→A→B) while a repeat run with nothing new sends nothing. `in_app` = the person saw the outage on screen when they added the address: recorded as told, never pushed.
- `live_activity_token` (iOS only): device_id, kind (`push_to_start|activity_update`), activity_id, token. When a new token arrives, invalidate the old one.
- `report`: outage_id, subscription_id, message, created_at ("Prijavi grešku")

**Identity key:** define the outage identity independently of the time window (city + municipality + date + normalized street set). This way a changed time is classified as `changed`, not as `new` + `cancelled`.

### Jobs (Europe/Belgrade)
- Scrape at 07:00, 13:00 and 19:00: fetch → hash → parse → split → resolve → persist → match → notify
- Evening-before reminders at 19:15 (after the 19:00 scrape)
- At `starts_at`, trigger the "outage active" surface on each affected device, and end it at `ends_at`:
  - **Android:** a data push that the app turns into the Live Update notification. Verify that data-only delivery through Expo Push works reliably with the app in the background or killed. If it does not, send that one message directly through FCM.
  - **iOS ([MAC]):** Live Activity push-to-start and end.
- Nightly: refit the scoring weights from confirmed aliases (once there are enough examples)
- Nightly `pg_dump` backup

### API (`/v1`, zod-validated, shared schemas)
There are no user accounts. On registration the server issues a random **device secret**. The app stores it with `expo-secure-store` (Keystore on Android, Keychain on iOS) and sends it on every request.
- `POST /devices`, `PATCH /devices/me` (token refresh, locale, script, quiet hours, notification kinds), `DELETE /devices/me` (delete all my data)
- `GET /cities`, `GET /cities/:city/gazetteer` (versioned, with an ETag, so the app can search offline)
- `GET|POST|PATCH|DELETE /subscriptions`
- `GET /me/outages?range=upcoming|history`, `GET /outages/:id`
- `GET /cities/:city/outages?date=` (city-wide browse)
- `POST /reports`
- iOS only: `POST /live-activities/push-to-start-token`, `POST /live-activities/:activityId/push-token`
- **Admin** (token-protected): `GET /admin/unresolved` (with candidates), `POST /admin/aliases` (confirm a candidate in one click; this triggers re-matching and notifications), `GET /admin/auto-accepted` (recent `scored` matches to spot-check, with one-click reject), `GET /admin/health` (last scrape per city, resolution rate per ladder step, notification counts per platform), `GET /admin/reports`

### Monitoring
Alert me by email and push to an admin device when:
- a scrape returns zero rows for all cities two runs in a row (the site probably changed)
- the resolution rate drops below 95%
- a fetch fails or the encoding detection fails
- a new unresolved segment appears for a future outage. The alert includes a direct link to that item in the admin queue.
- more than 1% of spot-checked auto-accepts get rejected
- the push failure rate on either platform rises above a set threshold

### Deployment (our dedicated server, shared with other internal services)
- A separate Docker Compose project with its own network, its own Postgres container and volume (never another service's database), and CPU/memory limits, so this app and the other services cannot affect each other.
- Do not take ports 80/443 directly. If the server already has a reverse proxy, put the API behind it on a subdomain; if not, use Caddy. Ask me during planning which applies.
- Admin endpoints are not reachable from the public internet: IP allowlist or VPN, plus the admin token.
- Secrets (Expo access token, FCM credentials, APNs key, admin token, DB password) live in an uncommitted `.env`. Commit a `.env.example`.
- Nightly `pg_dump` copied off the server with 14-day retention. Document the restore procedure in `docs/ops.md` and test it once.
- A `/healthz` endpoint for uptime monitoring, log rotation, and automatic restart on failure.
- Deploy with one command (`make deploy` or a GitHub Actions job over SSH). Migrations run before the new server version starts.

---

## 5. Notifications

| Kind | Trigger | Copy (sr-Latn) |
|---|---|---|
| `new` | New match for a saved address | `Isključenje struje: {ulica}, {dan} {HH:MM}–{HH:MM}` |
| `evening_before` | The evening before the outage | `Sutra bez struje: {ulica}, {HH:MM}–{HH:MM}` |
| `changed` | Time window changed (same identity key) | `Izmena: {ulica}, novo vreme {HH:MM}–{HH:MM}` |
| `cancelled` | Row missing for **two consecutive** runs, for a future date | `Otkazano: isključenje {dan}, {ulica}` |
| `reinstated` | A cancelled outage is published again; sent only to people who got "Otkazano" (a still-waiting "Otkazano" is withdrawn instead) | `Isključenje ipak važi: {ulica}, {dan} {HH:MM}–{HH:MM}` (en: `Outage reinstated: ...`) |

What a person was last told must match what EDS shows now, so every real change is told, in this way:
- A changed outage sends only "Izmena" to people already notified, never also "new".
- An edited street list notifies only the difference: added streets "new", removed streets "Otkazano", unchanged streets nothing.
- Ambiguous changes (several old/new rows that cannot be paired without guessing) send one "Izmena" listing the new windows.
- `reinstated` uses the "Izmena" Android channel and the same quiet-hours and urgent rules.
- An outage that flips more than twice raises a monitoring alert.
- A new saved address is not pushed outages that are already published: the app shows them on screen right away, and they are recorded as told (`in_app`) so later changes and the 19:15 reminder still reach the person.

- Write all copy in sr-Latn, sr-Cyrl and en. Use the user's script and language.
- **Quiet hours:** none between 22:00 and 07:00 (user-editable), unless the outage starts within 2 hours.
- **Urgent (outage starts within 2 hours):**
  - Android: a dedicated high-importance channel
  - iOS: the `timeSensitive` interruption level, with the Time Sensitive Notifications capability
- **Android channels:** one channel per kind, plus "Hitno" for urgent ones. Each has a clear Serbian name and description, so users can tune them in system settings.
- **Actions** on both platforms: **"Detalji"** (deep link to the outage detail) and **"Dodaj u kalendar"**.
- **Grouping by address:** Android group key, iOS thread identifier.
- **Permission:** Android 13+ needs the runtime notification permission. The pre-permission screen (§6) is shown on both platforms.
- **Delivery:** through Expo Push (FCM v1 for Android, APNs for iOS). Handle receipts and drop dead tokens.

---

## 6. App: functionality

The app is the same on both platforms. Only the native chrome differs, as described in §7.

**Navigation:** native tabs, **Početna · Najave · Istorija · Podešavanja**.
- Android: Material 3 bottom navigation, edge-to-edge, predictive back
- iOS: Liquid Glass tab bar on iOS 26 [MAC polish]
- "Add address" and "Outage detail" open as a modal bottom sheet on Android and a sheet with detents on iOS.

1. **Onboarding (3 steps)**
   - Value screen with a short animated bolt
   - Add the first address (the same flow as #2)
   - A notification **pre-permission screen** that explains why, shown *before* the system dialog. Both platforms give limited chances at the system prompt.
   - If the user denies permission, Home shows a persistent banner with a link to the system notification settings.
2. **Add address** (sheet)
   - City picker: Niš is active, other cities show as "Uskoro"
   - Street search against the locally cached gazetteer, with instant results. The search ignores script and diacritics, so `vojvode misica`, `mišića` and `војводе` all work.
   - Optional house number with letter suffix (`34a` / `34А`), numeric keyboard first
   - Label chips with platform symbols (Material Symbols / SF Symbols): Kuća, Posao, Roditelji, or custom
   - Confirmation preview, e.g. "Pratiću: Vojvode Mišića 34, Niš"
   - Up to 3 addresses (a constant, easy to raise). One address is primary.
   - **No GPS / no location permission.** Manual selection is more accurate because GPS cannot give the house number.
3. **Početna (Home)**
   - A status hero for the primary address (see §7)
   - A 4-day strip (today to +3) with dots on outage days
   - A card for each saved address, showing its next outage or "Nema najavljenih isključenja"
   - Pull to refresh
   - Footer: "Ažurirano pre 12 min · Izvor: Elektrodistribucija Srbije" plus a disclaimer link
4. **Outage detail** (sheet)
   - Date, time window, duration, and a countdown
   - A 24-hour timeline bar with the outage window and a "now" marker
   - The house ranges for the user's street, with the user's number highlighted, e.g. "Vaš broj 34 je u opsegu 26–40", or "Moguće pogođeno — niste uneli broj"
   - A mini map that highlights the affected street (OSM geometry, `expo-maps`)
   - The full list of affected streets (parsed), with an expandable view of the raw EDS text kept verbatim
   - Actions: Dodaj u kalendar · Podeli · Otvori izvor (EDS) · Prijavi grešku
5. **Najave**: all upcoming planned outages in the city, grouped by day and searchable (e.g. to check a relative's street). Any street can be followed from here.
6. **Istorija**: past outages for saved addresses, available offline and grouped by month, with a small summary (e.g. "Ove godine: 5 isključenja · 21 h bez struje").
7. **Podešavanja**
   - Pismo: Latinica / Ćirilica
   - Jezik: srpski / English
   - Notification types (on/off each). On Android this also links to the system channel settings.
   - Quiet hours
   - Manage addresses
   - Privacy and "Obriši sve moje podatke"
   - About: data source attribution, disclaimer, version, feedback

**Localization:** sr-Latn is the default, with sr-Cyrl and en also available. Keep sr-Latn as the source of truth and **generate sr-Cyrl with the parser's transliteration function**, plus a small manual override map. Street names are shown in the chosen script (`name_latin` / `name_cyrillic`).

---

## 7. Design: flagship quality on both platforms

The app should feel calm, trustworthy and current, closer to a modern bento dashboard than to a utility company website. Most of the time the answer is "you're fine". When it isn't, the app should make that clear at a glance.

**Direction v2 (22 Oct 2026):** the first gallery (system font, gradient mesh, Material You pastels, outlined chips) was rejected as looking like a 2013 app. The full spec is `docs/design/direction.md`, with the two reference images in `docs/design/references/`; this section summarises it and the file wins on any detail.

### Principles
- **Flat, bento, bold.** Solid fills only: no gradients, no mesh, no shadows or outlines to separate surfaces. Large rounded cards in a 1- and 2-column grid, each carrying one big number or one short headline with a small icon and a label.
- **One brand accent: electric lime** (`#D4F84A`), used as a fill (selected chip, primary button, selected day, switch on, the `clear` status) with near-black text on it. Never lime as text on a light background.
- **Strong hierarchy:** a big bold headline, huge numerals for times and countdowns (tabular figures only in a live countdown, so it does not jitter; static times, ranges and day numbers use the font's proportional digits), quiet secondary text, sentence-case labels (no letter-spaced capitals).
- **Platform-adaptive, not identical.**
  - Shared across platforms: layout, content, information hierarchy, motion and the signature elements.
  - Native per platform: the chrome and controls, so the app feels at home on each.
  - Use `.android.tsx` / `.ios.tsx` files only where chrome differs. Logic and data stay shared.
- **Android:**
  - Our own components and motion in the flat style above; no Material You dynamic colour. Status colours stay fixed and semantic (below)
  - Edge-to-edge (mandatory on current Android), predictive back, Material Symbols Rounded (filled), the embedded font with font scaling
- **iOS [MAC polish]:**
  - The same flat design. Native chrome where it differs: large titles, sheets with detents, context menus, SF Symbols
  - **Liquid Glass (iOS 26+):** `GlassView` / `GlassContainer` from `expo-glass-effect` for floating controls only (tab bar, sheets), with an `expo-blur` fallback on older iOS. The hero stays a flat card. Never glass on glass. Use solid surfaces with Reduce Transparency.
- **One signature element on both platforms:** the **status hero** on Home: a solid card in the status colour with a large faint bolt watermark (about 8 % opacity) in one corner, the status badge, a bold headline ("Bez struje", "Sutra bez struje", "Sve u redu"), the address and the huge countdown or time. The active state pulses gently, on the badge only.

### Visual system
- **Semantic status tokens.** Each status is a flat fill with its own text colour, in light, dark and high-contrast values (all WCAG AA, tested):

| Status | When | Fill | Android symbol | iOS symbol |
|---|---|---|---|---|
| `clear` | no outage | lime, dark text | `bolt` | `bolt.fill` |
| `upcoming` | announced, more than 24 h away | amber (about `#FFC23D`), dark text | `schedule` | `clock.fill` |
| `imminent` | less than 24 h | orange (about `#FF8A3D`), dark text | `timer` | `timer` |
| `active` | in the window now, with a soft pulse on the badge | red (about `#DC2F34`), white text | `power_off` | `bolt.slash.fill` |
| `cancelled` / `past` | — | the raised card fill, secondary text, struck-through time | `history` | `clock.arrow.circlepath` |

- **Color is never the only signal.** Every status also has an icon and a text label.
- **Surfaces (dark / light):** background `#0B0B0D` / `#F2F2F5`, card `#18181B` / `#FFFFFF`, raised or pressed `#222226` / `#E9E9EE`, text `#F5F5F7` / `#0B0B0D`, secondary text `#9A9AA3` / `#5C5C66`.
- **Typography:** one open-source (OFL) family, **embedded at build time** with the `expo-font` config plugin (static Regular, Medium, SemiBold, Bold and ExtraBold files; no system font, no runtime download). The family is one token, so a later change is a one-line edit. The candidates (Onest, Manrope, Unbounded for headlines with Onest for text) are compared on a type specimen screen; each was checked in the font files for Serbian Latin, Serbian Cyrillic (and the Serbian `locl` forms where present) and tabular figures (`tnum`). Scale: display numerals 56–72 ExtraBold (tabular in a live countdown only), headline 28–32 Bold, title 20 SemiBold, body 16, label 13–14 Medium in secondary colour. Font scaling still reflows up to 200 %.
- **Layout:**
  - 4-pt grid, 20-pt side margins and card padding, 12 between cards, 28–32 between sections
  - Radius 24 for cards; 16 for inputs, tiles and buttons; a full pill only for small badges
  - Minimum touch targets: 48 dp on Android, 44 pt on iOS
- **Controls:** chips are filled, never outlined (raised fill, lime when selected); radio choices are full-width rows with a lime check circle; checkboxes are 24 × 24 rounded squares, lime with a dark check; switches are a pill track, lime when on, with a white thumb; segmented controls (script, theme) fill the selected segment. Buttons: primary 56 high, lime with dark text; secondary on the raised fill; text button in lime on dark and primary text on light.
- **Dark mode is the showcase, light is just as finished.** Design both themes and follow the system setting.
- Build these as reusable components in `apps/mobile/src/design/`: `StatusHero`, `DayStrip` (four square tiles, the selected day lime, a status-coloured dot on days with an outage), `AddressCard`, `BentoTile`, `TimelineBar` (a 14-high track, the window in the status colour, "now" as a dot with a ring), `RangeChips` (the user's range filled lime), `CountdownText`, `Banner` (offline / notifications off), `EmptyState`, `SkeletonCard`, `SectionHeader`, plus the controls above. Put design tokens (colour, type, spacing, radius, motion) in one place with per-platform values.

### Motion and haptics
- Reanimated springs throughout. The hero crossfades when the status changes. Countdown digits roll. The active state pulses gently. List items enter with a short, subtle stagger.
- **Reduce Motion** (iOS) / **Remove animations** (Android) turns off non-essential animation.
- Use haptics sparingly, with the platform's native haptic types: selection on chips, success when an address is saved, a light impact when a refresh completes.

### States
Every screen has a designed **loading** state (skeletons, never a full-screen spinner), plus **empty**, **error**, **offline** and **permission-denied** states. The offline state shows cached data with the banner "Prikazujem sačuvane podatke".

### Accessibility
- Font scaling up to 200% (Android) and Dynamic Type up to the accessibility sizes (iOS), with no clipping (layouts reflow)
- TalkBack and VoiceOver labels in full sentences, e.g. "Isključenje struje u utorak od 8:30 do 12:30, Vojvode Mišića 34"
- WCAG AA contrast. Respect the platform settings for reduced motion and transparency.

### Beyond the app
**Android:**
- **Home screen widget** (Glance), in a small and a medium size:
  - small: next outage for the primary address (status, day, window, countdown)
  - medium: up to 3 addresses
- The widget updates when app data refreshes and at state boundaries (announced → imminent → active → past), so it changes state without the app being opened.
- **Live Update** during an active outage at a saved address:
  - an ongoing, promoted notification reading "Bez struje · povratak za 1 h 12 min", with a progress bar and a countdown chronometer, so it needs no per-minute updates
  - started by the server's data push at `starts_at` and dismissed at `ends_at`
  - on Android versions without Live Updates: a standard ongoing notification with the same content

**iOS ([MAC], `expo-widgets`):**
- **Home Screen widgets** `systemSmall` and `systemMedium` (same content as on Android)
- **Lock Screen widgets** `accessoryRectangular` and `accessoryCircular`
- Timeline entries are placed at state boundaries.
- **Live Activity** on the Lock Screen + Dynamic Island with the same content as the Android Live Update.
  - The backend starts it via **push-to-start** at `starts_at` (iOS 17.2+) and ends it at `ends_at`.
  - It also starts locally if the app is in the foreground.
  - The server tracks per-activity tokens.

### App icon
- A bolt glyph on a layered background, drawn as SVG source layers.
- **Android (now):** an adaptive icon (foreground + background layers) plus a **monochrome layer for themed icons**.
- **iOS ([MAC]):** a layered Liquid Glass icon with light, dark and tinted variants, finalized in Icon Composer. Until then, use a flat PNG generated from the same SVGs.

### Design QA (required before a platform phase is done)
- **Android (Phase 3, on Windows):**
  - Maestro flows on the local emulator visit every screen and state, using mocked API responses, and call `takeScreenshot`.
  - Runs: light and dark mode, and font scale 1.0 and 2.0. Use `adb` to switch the settings between runs.
  - Save the screenshots to `docs/screens/android/`.
  - Also write a short TalkBack checklist in `docs/qa-checklist.md`. I run it on my phone.
- **iOS (Phase 6, [MAC]):**
  - The same flows in the local simulator, in light and dark, at the smallest and largest Dynamic Type, and with Reduce Transparency
  - Save the screenshots to `docs/screens/ios/`, plus a VoiceOver checklist

---

## 8. Non-negotiables

- No webview anywhere. A thin wrapper around a public table gets rejected by App Store Guideline 4.2 and is weak on Google Play too.
- **Disclaimer:**
  - In the app: the app is **unofficial and not affiliated with EPS/EDS**. EDS is credited as the data source on Home and on Outage detail.
  - Both store listings state the same non-affiliation and link the EDS source page. Google Play requires this for apps that present government or public-sector information.
- Privacy:
  - No accounts, no location permission, no tracking SDKs
  - Collect only the push token, subscriptions and settings
  - A privacy policy page. The Google Play **Data safety** form and the App Store **App Privacy** label are both filled in to match.
- The `notification_log` dedupe constraint stays: `UNIQUE(subscription_id, outage_id, kind, revision)`.
- **No external or paid AI/LLM APIs.** Nothing in the running system calls Claude or any other hosted model, and it never spends tokens. Address recognition stays automatic through rules, spatial scoring and a model trained on our own confirmed data.
- The raw `Ulice` cell is always stored.
- Every bug in the parser or matcher gets a fixture-based regression test.
- TypeScript strict, zero lint warnings, all tests green before any phase is called done.

---

## 9. Phases and acceptance criteria

**Phase 0: Scaffold**
- Monorepo, tooling, CLAUDE.md, `.claude/settings.json`, CI, Docker Compose for local Postgres
- An Expo app shell that runs on the Android emulator with `npx expo run:android`
- ✅ `pnpm lint && pnpm typecheck && pnpm test` passes on a clean clone, and the shell launches on the emulator

**Phase 1: Data spike (no app code)**
- A collector script that fetches `Nis_Dan_{0..N}` (and discovers the slug list and the max N) and saves raw HTML with timestamps to `fixtures/`.
  - It must be runnable by cron on our server, so it can collect for 7–10 days without my laptop.
  - Start it first.
- An OSM gazetteer seed for Niš, including address points
- The parser, normalizer, range parser, matcher and the step-5 scoring prototype, with fixture-driven tests
- The alias seed file `packages/parser/data/aliases.json` for my review
- A labeled sample of about 200 segments (`fixtures/labels.csv`) with your proposed answers, for me to confirm. It is used to tune and measure the scoring.
- `docs/phase1-report.md`: distinct segment count, resolution % per ladder step, auto-accept precision on the labeled sample, and every failure class with examples
- 🚧 **GATE:** steps 1–5 resolve ≥95% automatically, auto-accepts are ≥99% correct on the labeled sample, and every failure class is understood. **Stop here and report.**

**Phase 2: Backend**
- Schema and migrations, scheduled ingestion, the resolution ladder, the matcher, the full API, admin endpoints, monitoring
- Deployment to our server
- Testing is with curl and a seeded fake subscription
- ✅ Integration tests pass against real Postgres. Replaying the fixtures produces the expected notifications, deduped, with no duplicates.

**Phase 3: Design system + app (Android first)**
- Platform-adaptive tokens and components first. Then every screen from §6, built against mocked API responses from the shared zod schemas. Then connect the screens to the real API.
- iOS code paths compile. iOS-only polish is stubbed and marked [MAC].
- ✅ The Android design QA screenshots are in `docs/screens/android/`, and the TalkBack checklist exists (§7).
- ✅ The Maestro flow (onboarding → add address → see outage → open detail) passes on the local emulator.
- ✅ An iOS EAS development build launches on my iPhone (smoke test, run only with my approval).

**Phase 4: Android notifications, widget, Live Update**
- Push end to end (all 4 kinds, channels, actions), deep links, calendar export, the Glance widget, and the Live Update with its fallback
- ✅ Each kind is verified on my physical Android phone via a development build.

**Phase 5: Harden and ship Android to Google Play internal testing**
- Change and cancellation detection verified against fixture sequences
- A second-city smoke test (Kraljevo) proves nothing Niš-specific leaked into the code
- EAS Build → EAS Submit to the Play **internal testing** track
- Draft the Play store listing in sr and en, with the Data safety answers
- If the Play developer account is a personal account, remind me about the closed-testing requirement (12 testers for 14 days) before a production release. An organization account is not subject to it.
- ✅ The 30-day live run starts on Android.

**Phase 6: iOS [MAC]**
- Liquid Glass polish, SF Symbols, iOS sheets and tab bar
- iOS widgets and the Live Activity with push-to-start
- The Icon Composer icon
- iOS push verification on my iPhone
- Simulator design QA
- EAS Build → TestFlight internal
- Draft App Store metadata in sr and en
- ✅ Each notification kind, the widgets and the Live Activity are verified on my iPhone, and the iOS screenshots are in `docs/screens/ios/`.

**Final success criterion (each platform):** for 30 consecutive days live, every outage affecting a test address produces exactly one correct notification, with zero missed outages.

---

## 10. Open questions to answer in Phase 1
- The full list of `{City}` slugs and how they map to municipalities
- The maximum `{N}`: how many days ahead EDS publishes
- The real character encoding of the pages, compared with the declared one
- Is the `Ulice` cell ever truncated in the HTML?
- Are apartment buildings distinguished from houses?
- How often pages change during the day: does a `Dan_0` page change after 07:00?
- How EDS marks changed or cancelled outages, if it marks them at all
