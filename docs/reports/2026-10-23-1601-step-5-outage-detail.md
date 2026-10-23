# Report: Phase 3, step 4 fixes and step 5 (outage detail), 23 Oct 2026

Stopped for review. Nothing from step 6 is started.

## Commits

| Commit                                         | What                                                              | On GitHub |
| ---------------------------------------------- | ----------------------------------------------------------------- | --------- |
| `e080680`                                      | Početna review fixes and step 5 (outage detail sheet), one commit | **no**    |
| (this report, committed right after `e080680`) | `docs/reports/` files                                             | **no**    |
| `066eeb0`                                      | Report for step 4                                                 | yes       |
| `49152c1`                                      | Step 4: Početna                                                   | yes       |

`origin/main` is at `066eeb0` (pushed on the owner's approval). Not pushed: `e080680` and the report commit. A push needs the owner's go-ahead.

## Checks (all green)

- `pnpm lint`: zero warnings. `pnpm typecheck`: 5 of 5.
- `pnpm test`: shared 22, parser 144 (+3 todo), scripts 62, server 227, **mobile 206 jest + 16 contract** (was 162 + 7).
- New: ranges and the detail view (`outage`), the "Dodaj broj" flow (`housenumber`), the permission check of the Expo config and of the merged Android manifest (`manifest`), the mock scenarios (`scenarios.test.ts`), and more `home` cases.

## The Početna fixes you asked for

a. **Tab bar:** card colour, lime indicator with a dark icon, the label of all four tabs always visible (Početna, Najave, Istorija, Podešavanja), no Material You tint.
b. **Tiles:** replaced. "Počinje za" is the hours until the next outage across all addresses ("25 h", "40 min", "2 d"; with several addresses it names the address); while an outage runs it becomes "Struja se vraća" with the time. "Ove nedelje" is the number of outages (each counted once, cancelled ones excluded) in the next four days. Both are hidden when there is no outage.
c. **Chosen day:** the cards' header reads "Adrese · subota 24." for any day but today.
d. **Possible matches:** the status colour stays; a "Moguće" badge with a question mark sits beside the status badge (hero and cards). When the only doubt is the missing house number, the card has a **"Dodaj broj"** button that opens a sheet (`/edit-address`), patches the address on the server (`PATCH /v1/subscriptions/:id`) and then on the device. A partial or unresolved doubt gets the badge but no button.
e. **Mock API scenarios** (development only): `clear`, `upcoming`, `imminent`, `active` (ends in 1 h 12 min), `cancelled`, `possible`, `three` (three addresses: active, imminent, possible), `offline` (the connection drops, so the app shows saved data with the offline notice). Start with `MOCK_SCENARIO=<name>` or switch with `POST /__dev/scenario`. "Notifications off" is real: the script revokes the Android permission, and Početna now reads the permission live, also when it is changed in the system settings. Screenshots, dark and light, are in `docs/screens/android/step4/` (69 files: `<scenario>-<mode>-<page>.png`, `detail-<scenario>-<mode>-<page>.png`, `possible-add-number-dark.png`). Command: `pnpm --filter @struja/scripts home-scenarios` (in CLAUDE.md).

## Step 5: the outage detail sheet

Opened from the hero or an address card (`app/outage/[id].tsx`, a bottom sheet).

- Header: status badge, the date ("petak, 23. oktobar"), the municipality; a note when the time was changed or the outage cancelled.
- The window: big time range (struck through when cancelled), duration, a running countdown inside 24 hours (to the start, or to the return while it runs) or whole hours/days further away, and the **24 h timeline** with the "now" dot on today.
- **For each saved address it concerns:** the ranges of its street as chips, the one holding the person's number highlighted, with "Vaš broj 34 je u opsegu 26–40"; or "Moguće pogođeno — niste uneli broj" with "Dodaj broj".
- The affected streets (script-aware; "delovi ulice", "cela ulica", ranges), and the **raw EDS text** behind an expander, exactly as published.
- Actions: **Dodaj u kalendar**, **Podeli**, **Otvori izvor (EDS)**, **Prijavi grešku** (a short form that posts to `/v1/reports`).
- Calendar uses the system "add event" screen through an Android intent (`expo-intent-launcher`), so there is **no calendar permission**; the manifest test checks the Expo config and the merged manifest of the last build for calendar and location permissions. I did not install `expo-calendar`, whose plugin would add them.
- The map is step 10, as planned.

## Bugs found on the emulator

- **Square day dots** after the data changed: Android kept the square background of a view whose colour changed from transparent. The dot is now re-made when its colour changes.
- The new native module needed a rebuild; until then the detail route crashed on load (expected, not a defect).
- `uiautomator` cannot read a screen with a running countdown ("could not get idle state"); the screenshot script taps by position and retries.

## Not verified / limits

- **Calendar:** the intent hands off to Google Calendar, which on this emulator only asks to sign in (no Google account), so I did not see the filled-in event. The event content is covered by a unit test; please try it once on your phone.
- **Share** and **Otvori izvor** are covered by tests, not exercised on the emulator.
- **Report an error** posts to the mock API only.
- iOS: the calendar button is not shown (the system editor comes with the iOS polish **[MAC]**).
- Mock API only; the real stack is step 9. Dev-only mock detail uses fixed example streets.

## Decisions needed

1. **Push** `e080680` and the report commit? (Needs your go-ahead.)
2. The status badge in the detail header does not repeat the "Moguće" badge (the text under the ranges says it). Add the badge there too?
3. The "notifications off" banner is tall because its action sits under the message. Compact it to one row, or keep?
4. Continue with **step 6, Najave and Istorija**?
