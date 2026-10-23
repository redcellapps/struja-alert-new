# Report: Phase 3, step 5 fixes and step 6 (Najave, Istorija), 23 Oct 2026

Stopped for review. Nothing from step 7 is started.

## Commits

| Commit                                         | What                                       | On GitHub |
| ---------------------------------------------- | ------------------------------------------ | --------- |
| `dbe9830`                                      | Step 5 review fixes and step 6, one commit | **no**    |
| (this report, committed right after `dbe9830`) | `docs/reports/` files                      | **no**    |
| `a4c826f`                                      | Report for step 5                          | yes       |
| `e080680`                                      | Početna review fixes and step 5            | yes       |

`origin/main` is at `a4c826f` (pushed on the owner's approval). Not pushed: `dbe9830` and the report commit. A push needs the owner's go-ahead.

## Checks (all green)

- `pnpm lint`: zero warnings. `pnpm typecheck`: 5 of 5.
- `pnpm test`: shared 22, parser 144 (+3 todo), scripts 62, server 227, **mobile 234 jest + 20 contract** (was 206 + 16).
- New: `lists` (grouping, search, both views, follow), `useNow` (the minute clock), more `outage`, `components`, `home` and `addresses` cases, and the mock's city list, history and detail.

## Your five fixes (step 5 review)

a. **Countdown:** "Povratak za 1 h 12 min" / "Počinje za 1 h 12 min" on the hero and in the detail sheet; under an hour "45 min"; under a minute **"manje od minuta"** (you wrote "manje od minut"; I used the correct genitive plural, tell me if you want it otherwise). It follows a clock that ticks on the full minute, so it never redraws every second. `CountdownText`, `H:MM:SS`, the rolling digits and the tabular digits are gone, which also removes the clipped rolling digit you saw in `active-dark-1.png`. Minutes are rounded up, as the spoken form is.
b. **Sheets** (the detail, Add address and "Dodaj broj"): rounded top corners (28), a grab handle (Android draws none, so the screen does), a close button (X) with the TalkBack label "Zatvori", and a clear gap above the detail sheet so the page title is whole.
c. **Notifications-off banner:** one row (icon, "Obaveštenja su isključena", "Uključi" on the right); the button drops under the text at large font sizes.
d. **"Moguće" badge** also in the detail header.
e. **Tile** "Naredna 4 dana": the big number and the word under it with the correct plural (isključenje, isključenja), without repeating the number.

## Step 6

**Najave** (`app/(tabs)/najave.tsx`): what EDS announced for the city, by day ("Danas · petak 23.", "Sutra · subota 24.", "nedelja 25."), each outage as a card with the time, the municipality, the first three streets and "i još 2", tags "Vaša adresa", "Otkazano", "Izmenjeno". Search by street or municipality in any script, case and diacritics ("cegar", "ЧЕГАР"). **Follow any street:** the streets that match what was typed appear under "Pratite ulicu" with a "Prati" button, even when no outage is announced for them, and the streets of an outage have a "Prati" button in the detail sheet; both open the Add address sheet with the street already chosen (you add the number and label and save). A street already followed says "Pratite"; at three addresses the buttons give way to "Već pratite najviše 3 adrese." Skeletons, empty ("Nema najavljenih isključenja"), "Nema rezultata za „…“", error with retry, the offline notice with the saved list, pull to refresh.

**Istorija** (`app/(tabs)/istorija.tsx`): the past outages of the saved addresses, newest month first ("Oktobar 2026", with a count), each as a card (the address label, the day and time, the duration; cancelled ones struck through with "Otkazano"); the **year in two tiles** ("Ove godine" count, "Bez struje" hours; cancelled outages do not count). It works offline from the saved copy. Both lists open the outage detail.

Mock API: a city list (the person's own outage plus six others: a cancelled one, a changed one, one with five streets), a history of six past outages per address, and details for all of them; the "clear" scenario gives a quiet city and a new person (empty states). Details of other people's outages show no ranges (they do not concern you).

Screenshots, dark and light: `docs/screens/android/step6/` (Najave, search, follow sheet, no results, an outage's detail with "Prati", offline, empty; Istorija, offline, empty) and a fresh set of Početna in every scenario in `docs/screens/android/step4/`. Commands: `pnpm --filter @struja/scripts list-screens` and `home-scenarios` (both in CLAUDE.md).

## Not verified / limits

- Mock API only; the real stack is step 9. The mock city list is small; real lists are longer, so the performance of a long list (a virtualised list) is not tested.
- Search matches by word beginnings in the street names and the municipality; it does not know EDS's alternative street names (the gazetteer has them for the Add address search only).
- "Prati" on a street opens the Add address sheet rather than adding at once: the person may want a house number or a label first.
- iOS **[MAC]** unchanged (calendar button, native tab bar styling). Calendar, share and "Otvori izvor" stay for your phone session at step 11.

## Decisions needed

1. **Push** `dbe9830` and the report commit?
2. **Follow flow:** keep opening the sheet (more taps, a deliberate choice), or add the street at once with a toast and "Dodaj broj" afterwards?
3. **Istorija** shows only outages of the addresses you have now; those of an address you deleted show "Obrisana adresa". OK, or should they be hidden?
4. Continue with **step 7, Podešavanja** (script, language, notification kinds, quiet hours, manage addresses, privacy and "Obriši sve moje podatke", about)?
