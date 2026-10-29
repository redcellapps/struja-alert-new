# Phase 4, first real push to the phone and the MagicOS first-run measurement

Date: 2026-10-29. Branch `main`. `1953dde` (steps 1-2) is pushed, as approved. This step's commits (`138921c` and the report commit) are **not pushed**. Stopped where you asked: after the first-run measurement with the default MagicOS settings, before the battery settings are applied.

## What was done

- **EAS and Firebase in the repo.** `extra.eas.projectId` (`8a4bd119-…`) was already in `app.json` from your `eas credentials` session and went in with `1953dde`; kept. `android.googleServicesFile` now points at `apps/mobile/google-services.json` (the file stays git-ignored; prebuild copies it into the native project). `eas.json` trimmed to the CLI section only: no build or submit profiles, no cloud builds. If `eas credentials` ever asks for a build profile again it offers to create one; the FCM key is per application id, not per profile, so nothing changes for push.
- **The arm64 debug build** (prebuild + `assembleDebug`, 4 min) installed on the HONOR Magic6 Lite as a fresh app, with the tunnels of `docs/phone-session.md`, Metro and the local server (`PUSH_PROVIDER=expo`, `ALLOW_REAL_PUSH_IN_DEV=true` in the server's environment for this session only; `.env` unchanged).
- **A dev tool from plan §5:** `pnpm --filter @struja/server dev:push <new|evening_before|changed|cancelled|reinstated> --subscription <id> [--outage <id>] [--urgent]` plans one notification through the ordinary outbox (`planOnDemand` in `plan.ts`: a negative revision, the time in seconds, so it never collides with a planned row and is easy to spot in `notification_log`) and wakes the deliver worker, so the push goes out within a second or two instead of at the next minute. `dev:push list` shows the subscriptions. `started` / `ended` are refused with a note: they are the data push of step 3. One test (server 262).
- The provider's comment about Android grouping was wrong and is corrected (see "Found" below).

## Verified end to end

| Check                             | Result                                                                                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration with a real token    | The app registered with `ExponentPushToken[…]` (the EAS project id is in the build); subscription 40, Trebinjska (Palilula), whole street                                                                            |
| First real push (12:05, app open) | In the shade 2.0 s after the server sent it, on the `new` channel, with the two buttons (`actions=2`), auto-cancel, our tint colour in the record; `docs/screens/android/phase4/05-first-real-push-in-the-shade.jpg` |
| Each kind on its own channel      | `new`, `changed`, `cancelled`, `evening_before` sent; the Android records show importance 3 (default) for all four, i.e. the right non-urgent channels                                                               |
| Expo tickets and receipts         | Every push got a ticket id; the receipts job marked the first four `ok` 18 to 20 minutes after sending (the 15-minute receipt delay plus the 5-minute job)                                                           |
| The development guard             | Unchanged: with `ALLOW_REAL_PUSH_IN_DEV=true` the real token was accepted; without it a development server rejects it (`dev-guard.test.ts`)                                                                          |

## The first-run measurement (MagicOS on the HONOR Magic6 Lite, Android 15, nothing changed by hand)

The app's state in MagicOS during all of this: **App launch → "Manage automatically" ON** (`06-magicos-app-launch-default.jpg`), notifications allowed in the onboarding. One thing to know: `dumpsys deviceidle whitelist` lists `rs.strujaalert.app` as a _user_ entry, i.e. Android's battery optimisation shows "Unrestricted" for the app although nobody set it (the old `rs.example.strujaalert` is listed the same way). Either MagicOS puts apps installed over USB debugging there, or it carried the old app's entry over. A person installing from the store may not get that, so the measurement below is "MagicOS default; Android's battery setting possibly more permissive than a store install". Worth one `dumpsys` line on the store build in Phase 5.

Time of sending is the server's `sent_at`; time of arrival is the notification's own `when` on the phone (`dumpsys notification`); both to the millisecond.

| #   | State of the app and the phone                                                | Kind           | Sent         | Arrived      | Delay                                       |
| --- | ----------------------------------------------------------------------------- | -------------- | ------------ | ------------ | ------------------------------------------- |
| A0  | App open on Početna, screen on                                                | new            | 12:05:30.069 | 12:05:32.063 | 2.0 s                                       |
| A1  | App in the background (home button), screen on, at once                       | changed        | 12:06:38.317 | 12:06:39.923 | 1.6 s                                       |
| A2  | App in the background, screen off for 10 min                                  | new            | 12:16:52.281 | 12:16:53.659 | 1.4 s                                       |
| A3  | App swiped away from recents (process gone), screen on, at once               | cancelled      | 12:17:38.400 | 12:17:40.628 | 2.2 s; FCM started the app process itself   |
| A4  | Process alive after A3, screen off for 10 min                                 | evening_before | 12:27:46.216 | 12:27:47.693 | 1.5 s                                       |
| A5  | Process killed by MagicOS (between 20 and 30 min idle), screen off for 30 min | new            | 12:59:14.621 | 12:59:16.881 | 2.3 s; the process was started again by FCM |
| A6  | Forced Doze (`deviceidle force-idle`), process killed, screen off             | changed        | 12:59:40.688 | 12:59:42.854 | 2.2 s                                       |

**Reading:** with the default MagicOS settings every notification push arrived within about 2 seconds, in every state: app open, in the background, swiped away, killed by MagicOS after 20 to 30 minutes idle, and in forced deep Doze. That is FCM delivering to Google Play services and expo-notifications posting the notification in a freshly started process; "Manage automatically" did not block a **high-priority notification push**. A caveat on Doze: the phone was on the USB cable the whole time, so it never entered Doze by itself (`deviceidle` stayed ACTIVE after 30 minutes); A6 forced it. What this does _not_ cover is the **data push + headless task** of step 3 (the "outage started" signal, the widget refresh): a process start for background work is exactly what MagicOS's manager restricts, and that is where the plan's D.2 and D.3 settings may matter. So there is no evidence yet that a MagicOS card is needed for the notifications themselves; the wording and placement of the card wait for the step 3 measurement, as decided.

## Found

1. **No Android grouping over Expo push.** Expo's push API sends `threadId` to iOS only (the sending-notifications page, checked today); expo-notifications groups an Android notification only when the FCM data carries `threadIdentifier`, which Expo does not add. The phone's records confirm it: the group key is the default one. Local notifications (the gallery lab, step 2) are grouped; remote ones are not. Options: (a) accept it on Android: the shade lists each notification, newest first, nothing is lost; (b) `tag = address-<id>`: Android _replaces_ the previous notification of the same address with the newest, so the shade shows one line per address with the latest state (an "Izmena" replaces its "Novo isključenje"); (c) send data-only pushes and have the step 3 headless task post the notification locally with the group, which puts the delivery of every notification at the mercy of background execution, the thing MagicOS restricts; I advise against it. **I recommend (b)**: one line in the provider, one in its test. Your call.
2. **The app icon on the phone is still Expo's template** (`assets/icon.png`, `android-icon-*.png`): a blue chevron in the launcher, recents and settings. Not this step; noted for the store-prep step.
3. **The notification's icon tile in the shade is blue on MagicOS**, not our lime: MagicOS draws the small icon on a tile colour of its own. Cosmetic; nothing to do.
4. The on-demand `evening_before` says "sutra" relative to the delivery day, as designed, so its text can name a day that does not match the outage; a dev-tool artefact, not a bug.

## Tests and gate

`pnpm lint` 0 warnings · `pnpm typecheck` green (incl. iOS) · `pnpm test` exit 0: mobile **354** jest + 23 contract (6 live skipped) · server **262** (+1) · parser 174 (+3 todo) · shared 23 · scripts 62.

## Decisions needed

1. Grouping on Android: (a), (b) or (c) above; I recommend (b).
2. **Apply the battery settings now** (plan D.2 and D.3: App launch → Struja Alert → Manage automatically off, then Auto-launch, Secondary launch and Run in background on; Battery → Unrestricted) and tell me; I repeat A3, A5 and A6. Given the result above I expect no change for notification pushes; the comparison matters for step 3.
3. Then step 3 (the data push and the headless task), with the same measurement.

## Not pushed

`138921c` (code) and the report commit. Say "push" and I push both.
