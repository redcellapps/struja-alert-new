# Phone session (step 11): the automated part, run on the real phone

Date: 2026-10-28, 13:50 to 14:05. HONOR Magic6 Lite 5G, Android 15, arm64, USB. The debug APK of step 11 (arm64), Metro on :8081 and the real local API on :3000, both through `adb reverse`. Data: the saved Niš pages shifted by 120 minutes so that an outage was in progress (`dev:fixtures --shift=120 --repeat-today`, then `dev:scrape`). Driven over adb (taps, `uiautomator dump`, screenshots); **TalkBack and the "feel" items are left for the owner** (checklist in `docs/phone-session.md`, sections 5 and 6).

Nothing was saved to the phone's calendar, nothing was shared with anyone, notifications were declined in the onboarding, and airplane mode is off again.

## Results against the checklist

| # | Item | Result |
| --- | --- | --- |
| setup | install, tunnels, bundle | OK. `phone-session --install` installed the APK, set both tunnels, the app loaded the bundle from Metro and the data from the local API. |
| onboarding | three steps, street search, house number, save | Works, but see **Finding 1** (keyboard). Saved "Trebinjska 34"; Početna shows "Bez struje, Trebinjska 34, Povratak za 2 h 1 min, Moguće pogođeno" (the house number is not in the listed ranges, so "possible" is right). |
| 1 Calendar | "Dodaj u kalendar" | **OK.** The system "New event" screen (Honor Calendar) opens with **no permission prompt**; title "Isključenje struje", Oct 28 **11:00 to 16:00** (same as the detail), location "Trebinjska 34", notes "Trebinjska 34, Izvor: Elektrodistribucija Srbije" and the EDS link. "Discard" returns to the same detail screen. Note: the notes name only the person's own address, not every street of the outage. |
| 2 Share | "Podeli" | **OK.** System share sheet. Text: "Planirano isključenje struje: sreda, 28. oktobar (Danas) 11:00–16:00. Trebinjska 34. Izvor: Elektrodistribucija Srbije, https://elektrodistribucija.rs/…/Nis_Dan_0_Iskljucenja.htm". Nothing about other addresses. Back cancels and returns to the app. Same remark: only the person's street. |
| 3 Otvori izvor | "Otvori izvor (EDS)" | **OK.** Opens the EDS page in **Chrome** (the phone's browser, not a webview); Back returns to the app. This tap makes the phone request the live EDS page once, as a person's browser (not the scraper). The "unofficial app" wording in Podešavanja was not re-checked on the phone. |
| 4 Map | start, button, credits, scroll | **OK.** The map appears within seconds, starts on the house (lime dot), labels readable (Latin, dark theme); "Celo isključenje" shows the whole outage and becomes "Moja adresa" and back; credits "© OpenStreetMap · © OpenMapTiles · OpenFreeMap" stay in view and **open the OSM copyright page in the browser**; a finger swipe on the map **scrolls the sheet and the map does not pan**. Not checked: light theme, Ćirilica, the shared-name outage (Pantelej). |
| 4 Map, offline | airplane mode | **Not OK, Finding 2.** |
| 5 TalkBack, 6 other | | Owner. |

## Findings

1. **Onboarding step 3: the keyboard covers the street field and its results.** Tapping "Ulica ili naselje" raises the keyboard (SwiftKey, with a number row, about 40 % of the screen) and the screen does not move: the field (y 1444 to 1626 of 2652) is under it, so you cannot see what you type or the results. After closing the keyboard the typed text and the result are there. This is the phone only: in the emulator the Maestro flow passes because it does not need to see the field. Likely fix: scroll the field into view when it gets focus (or a `KeyboardAvoidingView` / `scrollToEnd` on focus) in the onboarding screen. The same may apply to the add-address sheet: not checked on the phone.
2. **The map is not dropped when only coarse tiles are cached.** In airplane mode, opening an outage in an area the map had never shown (Čegarska, Niška banja) gave a dark box with the red line, two pale green land areas and the credits: **no roads, no labels**, still there after 25 seconds (the 8 s timeout did not drop it). Cause (in the code): `BASE_LAYER_IDS` in `src/map/style.ts` counts `park` and `landcover`, and the map cache held coarse tiles that draw those, so "ready" was reached. The rule "never shown blank" is not kept in this state. Proposed fix: count only `road-*` and `building` as proof that the tiles arrived (an outage always has streets), keep the 8 s timeout, add a test. Not done: the app was running on the phone.
3. The result row shows the municipality as a raw lowercase key ("palilula"): already known; it should read "Palilula".
4. `scripts/package.json` was missing the `phone-session` entry (the report of the emulator part said it existed); it is added in this commit.

## Not done

TalkBack (checklist section 5), sunlight and speed impressions (section 6), the light theme and Ćirilica on the map, the shared-name outage in Pantelej.

## Decisions needed

1. Fix Finding 1 (keyboard in onboarding and in the add-address sheet) and Finding 2 (map readiness test), with tests? Both are small.
2. Push `4cdb935`, `792449e`, `3d7147c` and this commit?
3. TalkBack: you do section 5 on the phone (the stack is still running: server, Metro, tunnels), or I stop it.
