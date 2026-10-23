# Report: Phase 3, step 4 (Početna), 23 Oct 2026

Stopped for review. Nothing from step 5 is started.

## Commits

| Commit                                         | What                                                                                                   | On GitHub |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| `49152c1`                                      | Phase 3 step 4: Početna                                                                                | **no**    |
| (this report, committed right after `49152c1`) | `docs/reports/` files                                                                                  | **no**    |
| `2beb84f`                                      | Tabular digits only in the live countdown; PM-session reporting rule; retaken `design-review-v2` shots | yes       |
| `f18e709`                                      | Step 3: onboarding and Add address sheet                                                               | yes       |

`origin/main` is at `2beb84f` (pushed on the owner's approval: `d07ce1f..2beb84f`, 7 commits). Not pushed: `49152c1` and the report commit. A push needs the owner's go-ahead.

## Checks (all green)

- `pnpm lint`: zero warnings. `pnpm typecheck`: 5 of 5.
- `pnpm test`: shared 22, parser 144 (+3 todo), scripts 62, server 227, **mobile 162 jest + 7 contract**.
- New in step 4: `outlook` 12, `home` 16 (formatting and every `HomeView` state), `device` 5 (registration and recovery; this file had no tests before).

## Done in this round

1. **Design fix:** tabular digits only in the live countdown (`CountdownText`). Static times, ranges, tile values and day numbers use Onest's proportional digits, so there is no gap after a `1`. BRIEF §7 and the font notes match; `design-review-v2` retaken (43 PNGs). Font stays A (Onest).
2. **CLAUDE.md:** the PM-session reporting rule plus the `docs/reports/` file fallback.
3. **Step 4, Početna** (`apps/mobile/app/(tabs)/index.tsx`, `src/home/`):
   - **Hero** for the primary address: clear, upcoming ("Sutra bez struje" / "U petak bez struje"), imminent ("Uskoro bez struje", countdown to the start), active ("Bez struje", countdown to the return), cancelled (struck-through time). "Moguće pogođeno" shown when a match is not certain.
   - **Day strip** of four days with a dot on days that have an outage; choosing a day switches the address cards to that day.
   - **Tiles** "Sledeće" (or "Struja se vraća" while active) and "Trajanje".
   - **Address cards**, one per saved address (up to 3), "Dodaj adresu" until the limit.
   - **Pull to refresh**, a freshness line ("Ažurirano pre 12 min"), the EDS credit and the disclaimer as a link.
   - **States:** skeletons while loading, empty start with one action, error with retry, offline notice with the last data ("Prikazujem sačuvane podatke"), "notifications off" banner (opens the system settings).
   - **Data:** `/v1/subscriptions` and `/v1/me/outages` through TanStack Query with the persisted cache; refetch when the app comes back to the foreground; saving an address refreshes Početna.

## Bug found and fixed on the emulator

The mock server restarted (a lost device). Both Početna queries got a 401 at the same moment and **each started its own recovery**, so the app registered twice and added the address twice (two cards). Recovery now runs once however many requests fail together, and a request that failed with already-replaced credentials just retries (`singleFlightRecovery`, with a regression test). Verified on the emulator against the mock API: two 401s, one `POST /v1/devices`, one `POST /v1/subscriptions`, two retried reads, one card.

## Not verified / limits

- Only the mock API was used. The imminent and active states are covered by unit tests, but the mock serves a single outage 26 hours ahead, so on the emulator I saw "upcoming" only.
- Cards are not tappable yet: the outage detail is step 5.
- The disclaimer link goes to the Settings tab, which is still a placeholder (About arrives in step 7).
- The real Docker stack is step 9.
- Screenshots (dark, light, a chosen day, the footer): `docs/screens/android/step4/`.

## Decisions needed

1. **Push** `49152c1` and the report commit? (Needs your go-ahead.)
2. **Hero scope:** it shows the primary address only; the day strip switches the cards below, not the hero. OK, or should the hero follow the chosen day?
3. **"Possible" matches** (address may be affected) keep the normal status colour and add a line of text ("Moguće pogođeno — niste uneli broj"). OK, or should they look different?
4. Continue with **step 5, the outage detail sheet**?
