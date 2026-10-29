# Phase 4, round 2: the Android tag, the second MagicOS measurement (Battery "Optimized"), the notification icon

Date: 2026-10-29. Branch `main`. `138921c` and `bca967d` are pushed, as approved. This round's commit (code, plans, screens, this report) is **not pushed**. Stopped where you asked: after the measurement with Battery "Optimized", before you apply the full settings.

## What was done

1. **Grouping on Android is the tag per address.** The provider now sends the address key (`address-<street id>`) as both the iOS `threadId` and the Android `tag` (one line in `apps/server/src/notify/expo.ts`, one assertion in its test). Expo's push service forwards `tag` to Android only, and expo-notifications uses it as the notification's identifier, so Android replaces the shown notification of the same address with the newest. **Verified on the phone:** B6 ("Izmena", `changed`) replaced B5 ("Isključenje struje", `new`) for Trebinjska; the shade kept one line for the address, with the tag `address-3151` in the record. Local notifications keep the app-made group summary. The plan is corrected (`docs/phase4-plan.md` §3 step 2 and §8 decision 8).
2. **The notification icon tile.** Nothing to change: the config already has `color: "#D4F84A"` (lime) and the small icon `assets/notification-icon.png` is a 96×96 white silhouette of the bolt (only white pixels, the rest transparent; the native project carries `notification_icon_color` `#D4F84A` and the `notification_icon` drawable). The phone's notification records carry `color=0xffd4f84a`. The blue tile is MagicOS's own drawing, see "Found" 1.
3. **The real app icon is in the Phase 5 plan** (`docs/PLAN.md`, Phase 5, before the first Play build: bolt glyph per BRIEF §7, SVG source, adaptive foreground + background layers, the monochrome layer for themed icons), and `docs/phase4-plan.md` §8 decision 9 says so. Not built.
4. **The second measurement** below.

## The measurement: Battery "Optimized" (set by you), App launch still "Manage automatically"

`dumpsys deviceidle whitelist` no longer lists the app, so the battery setting is really "Optimized" now (the earlier "Unrestricted" was a leftover, as suspected). Phone on USB the whole time; the server restarted at 14:27 with the tag change, so B5 and B6 went out with the tag and B3 without. Sending time is the server's `sent_at`; arrival is the notification's `when` on the phone.

| #   | State of the app and the phone                                                                       | Kind    | Sent         | Arrived      | Delay                                             |
| --- | ---------------------------------------------------------------------------------------------------- | ------- | ------------ | ------------ | ------------------------------------------------- |
| B3  | App swiped away from recents (process gone), screen on, at once                                      | new     | 14:22:33.115 | 14:22:35.834 | 2.7 s; FCM started the app process itself         |
| B5  | Screen off for 30 min after B3; the process FCM had started was **still alive** at 20 and at 30 min  | new     | 14:53:19.136 | 14:53:21.246 | 2.1 s                                             |
| B6  | Process killed (`am kill`, what the system does under memory pressure), screen off, forced deep Doze | changed | 14:53:53.283 | 14:53:55.801 | 2.5 s; FCM started the process again; replaced B5 |

For comparison, round 1 (Battery "Unrestricted" by accident): A3 2.2 s, A5 2.3 s, A6 2.2 s.

**Reading:** with Battery "Optimized" and "Manage automatically" on, notification pushes still arrive in 2 to 3 seconds in all three states. One difference from round 1: this time MagicOS did not kill the FCM-started process within 30 minutes (in round 1 it was gone between 20 and 30 minutes), which says the kill is MagicOS's judgement call rather than a fixed timer; either way the push arrives, because FCM starts the process. The same caveats as before: USB power, so Doze was forced (`force-idle`), not natural; the data push and the headless task of step 3 are not covered by this.

## Found

1. **The tile colour is not ours to set, on either OS.** On MagicOS (Android 15) the shade shows our white bolt on a tile MagicOS colours itself (blue), ignoring the notification `color`. On stock Android 17 (the Pixel emulator, `07-stock-android-17-shade-app-icon.jpg`) the shade shows the **launcher icon**, not the small icon at all; the small icon appears only in the status bar (`08-stock-android-17-status-bar-small-icon.jpg`: the white bolt). So the only thing that changes the look in the shade is the real app icon (Phase 5): with Expo's template icon, both systems show a blue thing. The `color` still matters where Android draws the small icon (status bar on older versions, some OEMs), so it stays lime.
2. B3's notification (sent before the restart, so without a tag) and B6's are both in the shade; MagicOS stacks them in one card for the app (`09-tag-replaced-in-the-shade.jpg`: "Izmena" on top, B3's "Isključenje struje" under it; B5 is gone, replaced). From now on every push carries the tag, so a second line per address does not recur.

## Tests and gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · `pnpm test` exit 0: mobile **354** jest + 23 contract (6 live skipped) · server **262** · parser 174 (+3 todo) · shared 23 · scripts 62.

## Decisions needed

1. **Apply the full settings now** (App launch → Struja Alert → Manage automatically off, then Auto-launch, Secondary launch and Run in background on; Battery → Unrestricted) and tell me; I repeat the same three cases (swiped, 30 min, forced Doze). The server, Metro and the tunnels are still up.
2. Whether to push this round's commit.
