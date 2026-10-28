# Phone session (step 11): the app on a real phone, against the local server

One physical Android phone on a USB cable. It reaches this computer through `adb reverse`: Metro on `localhost:8081`, the API on `localhost:3000`. No Wi-Fi, no public server, nothing leaves the machine. Push notifications are **not** part of this session (they are logged by the server, real delivery is Phase 4).

## Set up (about 15 minutes, most of it the build)

On the phone: Settings > About phone > tap "Build number" seven times; Settings > System > Developer options > turn on **USB debugging**; connect the cable, choose "File transfer", accept the "Allow USB debugging?" prompt. `adb devices` must list the phone as `device`.

1. **The debug APK for the phone's CPU** (the emulator build is x86 and does not run on a phone). Close the emulator first (memory), then:
   ```powershell
   cd C:\sa\apps\mobile
   npx expo prebuild --platform android --no-install
   cd android
   .\gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
   .\gradlew --stop
   ```
   The APK is `apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk` (about 5 minutes).
2. **The local stack with data for today.** In `C:\sa`:
   ```powershell
   docker compose -f docker/compose.yaml up -d
   pnpm --filter @struja/server db:migrate
   pnpm --filter @struja/server dev:import-gazetteer
   pnpm --filter @struja/server dev:fixtures -- --shift=<minutes> --repeat-today
   ```
   `--shift` moves every outage time so that something is "now": the saved pages have outages from 08:00 to 17:00, so at 14:00 use `--shift=120`, at 17:00 `--shift=300` (the shift must keep every time inside the day). Then start the server as its own process, in a second PowerShell window:
   ```powershell
   cd C:\sa\apps\server
   $env:NODE_ENV='development'; $env:FIXTURES_DIR='C:\sa\.dev\eds'; $env:PAGE_SOURCE='fixtures'
   $env:ADMIN_TOKEN='a-token-of-at-least-16-characters'
   node --experimental-strip-types --env-file-if-exists=../../.env src/main.ts
   ```
   and ingest the pages once: `pnpm --filter @struja/server dev:scrape` (the shift can be changed and scraped again: the earlier rows are replaced like real changes).
3. **Metro, bundled for the phone's tunnel** (a third window):
   ```powershell
   cd C:\sa\apps\mobile
   $env:EXPO_PUBLIC_API_URL='http://localhost:3000'
   npx expo start --dev-client --port 8081
   ```
4. **Install and open:** `pnpm --filter @struja/scripts phone-session --install`. It checks the phone, the API and Metro, sets both tunnels, installs the APK, grants the local-network permission the debug build asks for, and opens the app. The first start bundles for a minute. Add Trebinjska 34 (a house OSM knows: it gets the house marker) and one more street in the outage you want to look at.

If something is off: `adb devices` (is the phone there), `adb reverse --list` (both tunnels), `curl localhost:3000/healthz`, `curl localhost:8081/status`.

## The checklist

Mark each line and add a few words where it is not right. Take a screenshot of anything odd (power + volume down).

### 1. Calendar (outage detail > "Dodaj u kalendar")

- [ ] The system "new event" screen opens; **no permission prompt** appears (the app never asks for the calendar).
- [ ] Title is the outage ("Isključenje struje: ..."), the start and end are right in Belgrade time, the notes name the streets and credit Elektrodistribucija Srbije.
- [ ] Saving it puts the event in the calendar; going back without saving returns to the app on the same screen.

### 2. Share (outage detail > "Podeli")

- [ ] The system share sheet opens. Share to Messages / Notes: the text is in the chosen script, names the street(s), the day and the window, and carries the source credit. Nothing about your other addresses.
- [ ] Cancelling the sheet returns to the app.

### 3. "Otvori izvor (EDS)" and "Otvori sajt Elektrodistribucije" (Podešavanja > O aplikaciji)

- [ ] The EDS page opens in the **phone's browser**, not inside the app (no webview). Back returns to the app.
- [ ] The app does not claim to be official ("Nezvanična aplikacija, nije povezana sa EPS ili EDS").

### 4. The map (outage detail > "Pogođene ulice")

- [ ] The map is there within a few seconds, labels readable, in the script chosen in Podešavanja (try Latinica and Ćirilica), in light and in dark.
- [ ] It starts on the house (the lime dot) when the address has a number; "Celo isključenje" shows the whole outage, "Moja adresa" goes back.
- [ ] The credits "© OpenStreetMap · © OpenMapTiles · OpenFreeMap" stay in view; tapping them opens the OSM copyright page in the browser.
- [ ] Scrolling the sheet with a finger on the map scrolls the sheet (the map does not capture it) and the map does not pan.
- [ ] Airplane mode on, open an outage again: **no map and no gap**, only the street list ("Prikazujem sačuvane podatke" if the saved copy is shown).
- [ ] An outage whose street name several streets share ("Gornjomatejevačka and Studenička" in Pantelej): the note "Više ulica nosi ovo ime...", every candidate street dashed and lighter.

### 5. TalkBack (Settings > Accessibility > TalkBack; turn it on, swipe right to move, double-tap to activate)

- [ ] **Onboarding:** each step is read in full ("Korak 2 od 3", the heading, the button), the progress is not a trap, "Ne sada" is reachable.
- [ ] **Početna:** the hero is one announcement ("Bez struje, ..., povratak za 1 sat 12 minuta" or similar), then the day strip (each day says its date and whether it has an outage), the tiles, the address cards. No unlabelled button ("button" with no name).
- [ ] **Tab bar:** four tabs, the selected one is announced as selected.
- [ ] **Outage detail:** the reading order is sensible (status, date, window, countdown, address card, streets, actions). The timeline bar is a sentence, not noise. The **map is skipped** (the street list is its version) and the "Celo isključenje" button is reachable and named. "Zatvori" is the first thing after the sheet opens.
- [ ] **Add address:** the search field is named, each result is read with its municipality or settlement, the house number field is named, the chips and the "Glavna adresa" checkbox say their state, "Sačuvaj adresu" is reachable without the keyboard closing it.
- [ ] **Podešavanja:** every switch and segmented choice says what it is and its state; "Obriši sve moje podatke" asks for confirmation and says what it deletes (cancel it).
- [ ] With the system font at the largest size, nothing is cut off and every action is still reachable (the app already holds this at 200 % in the emulator).

### 6. Anything else you notice

Speed of the first start, scrolling smoothness, colours in sunlight, a tap target that is hard to hit.

## When done

`adb reverse --remove-all`, stop Metro and the server (`Ctrl+C`), `docker compose -f docker/compose.yaml down` if you do not need the database, and tell me the results: what passed, what did not, with the screenshots. The emulator results of step 11 are in `docs/screens/android/step11/` and the report in `docs/reports/`.
