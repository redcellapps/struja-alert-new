# Phone-session fixes: keyboard, offline map, municipality names, calendar and share text, large font

Date: 2026-10-28. Branch `main`. `4cdb935`, `792449e`, `3d7147c` and `1e93292` are pushed (approved). This step's commit is **not pushed**.

The five fixes asked for after the automated phone session, each with tests. The three that show on the screen were checked on the real phone (HONOR Magic6 Lite 5G) through Metro and Fast Refresh; the **offline map could not be re-tested on the phone: it dropped off USB** (see the end).

## 1. Keyboard in onboarding step 3 and in the Add address sheet

**The cause:** the window is not resized by the keyboard (edge to edge, Android 15), so a field low on the screen stayed under it.

**The fix** (`src/design/components/Screen.tsx`, `AddAddressForm.tsx`):
- `Screen` leaves the keyboard's height free at the bottom while it is up (so the content scrolls in the part in view), and offers `useScreenReveal()`.
- The street field asks to be revealed when it gets focus: the scroll waits for the keyboard and puts the field at the top of what is in view. It asks again when the results change, because they arrive after the keyboard and make the screen longer (found on the phone: the first version stopped too early). The house number field is revealed the same way.

**On the phone:** Add address sheet: the field is at the top of the visible area with two results ("Čegarska · Pantelej", "Čegarska · Niška Banja") fully visible above the keyboard (before: the field was hidden). Onboarding step 3 (from a cleared app): the field and "Trebinjska · Palilula" are above the keyboard.

**Tests:** `keyboard.test.tsx` (the screen leaves the keyboard's room and gives it back; reveal before and after the keyboard is up). **Maestro:** `01-onboarding` and `04-tabs-and-settings` no longer hide the keyboard before choosing a result: they tap the result with the keyboard up and assert that the house number field appears; a result under the keyboard could not be tapped, so the flow fails if the field is hidden again. **These two flows were changed but not run** (the emulator is not up and the mock API cannot share :3000 with the real server that the phone uses): they run in the next `qa-screens`.

## 2. Offline map: only streets and buildings count as "loaded"

`BASE_LAYER_IDS` is now `building`, `road-minor`, `road-mid`, `road-major` (`src/map/style.ts`). Land, park and water are no longer proof that the tiles arrived; without a street the 8 s fallback to the street list applies. Tests: a map where only land, park and water have features is dropped after the timeout; the map asks only about streets and buildings. **Not yet re-tested in airplane mode on the phone.**

## 3. Municipality name

The gazetteer carries the municipality as a key ("palilula", "niska banja", "crveni krst", "medijana", "pantelej"); `placeMunicipality` now maps them to "Palilula", "Niška banja", "Crveni krst", "Medijana", "Pantelej" (and the Cyrillic names). On the phone: "Trebinjska · Palilula". Test in `gazetteer.test.ts`, all five names in both scripts.

## 4. Calendar notes and share text

`src/outage/actions.ts`: `affectedStreets` lists every street of the outage once (the outage's own segments, in the chosen script).
- **Share text:** "Planirano isključenje struje: <day, window>. <every street of the outage>. Izvor: …". It no longer contains the person's saved address (before: "Trebinjska 34"); never the other addresses either.
- **Calendar:** the notes list every street with its ranges ("Vojvode Mišića: neparni 1–41, 50–60", "Studenička: delovi ulice", "Kosmajska: cela ulica", unresolved text as written) and the source; the **location** is still the person's own address that the outage concerns (it is their own calendar).
- **Decision for you:** the share text drops the person's house number on purpose (it goes to other people). If you want your own address in it, say so.

Tests (`outage.test.tsx`): every street, once each, with ranges; Cyrillic; the share text has no saved address.

## 5. Large font: the title and the city chips collapse while typing

From a font scale of 1.5, focusing the street search hides the city chips (in the form) and the title (in the Add address sheet and in onboarding step 3); they return when the field loses focus. Tests in `address-typing.test.tsx` (normal font keeps them; 200 % hides them, keeps the field and the results, and brings them back). Not seen on the phone at 200 %.

## Gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · mobile **337** jest tests (was 328; +9: 2 keyboard, 2 typing, 2 map, 1 municipality, 2 actions) · server, parser, shared and scripts unchanged and not re-run in this step.

## The phone

- **No reinstall was needed:** every change is JavaScript; the debug APK on the phone loads it from Metro (the same APK installed earlier). A native rebuild would only waste time.
- **The phone dropped off USB** in the middle of the checks: Windows still lists "HONOR Magic6 Lite 5G" (as a media device) but `adb devices` is empty, the state seen before the first session (USB debugging off, or the USB mode changed). The local server and Metro are still running; the `adb reverse` tunnels went with the connection. **To bring it back:** in Developer options turn USB debugging off and on, set the USB mode to "File transfer", accept the prompt; then tell me. I will run `phone-session` (tunnels and the app), do the airplane-mode re-test of fix 2 and hand the phone over for TalkBack.
- The phone's app data was cleared for the onboarding check: the app is at onboarding step 2, no address saved. Save Trebinjska 34 again before TalkBack (I will do it if you want).

## Decisions needed

1. Reconnect the phone (above) so that I can finish the airplane-mode re-test and set the app up for TalkBack.
2. The share text without the person's own address: OK?
3. Push this step's commit?

## Addendum (14:57): offline map re-tested on the phone

After the phone came back: online, the Trebinjska map was opened (also the whole-outage view, so coarse tiles were cached); then airplane mode on and the Čegarska outage (Niška banja, never loaded) opened. At 3 s a plain placeholder where the map goes; **after 15 s the map is gone completely: "Pogođene ulice" goes straight to the street list**, no blank box and no stray line (before the fix: the red line on bare land, still there after 25 s). Airplane mode is off again, Wi-Fi is back, the tunnels (:8081, :3000) are up. Trebinjska 34 is saved again (the app was at onboarding after the data was cleared for the onboarding check; the notifications permission was skipped, so Početna shows the "Obaveštenja su isključena" banner).

The phone dropped off adb three times in this session (always after 10 to 20 minutes); not an app problem.

Still to do before step 11 closes (asked): run the two changed Maestro flows (`01-onboarding`, `04-tabs-and-settings`) against the mock, after the phone session.
