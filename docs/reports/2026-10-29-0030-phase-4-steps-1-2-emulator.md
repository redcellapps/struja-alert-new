# Phase 4, steps 1 and 2: the push pipeline, channels, actions, grouping and deep links (emulator part)

Date: 2026-10-29. Branch `main`. `127459d` (the plan) is pushed. This step's commit is **not pushed**. Stopped at the first milestone of `docs/phase4-plan.md` §3: everything up to the first real push to the phone is built and verified with local notifications on the emulator; the real push waits for your A to D and `eas init`.

## What is built

**Server (`apps/server`)**

- `ExpoPushProvider` (`src/notify/expo.ts`, `expo-server-sdk` 8): Expo's chunks, tickets, receipts, `DeviceNotRegistered`; every message `priority: high`, on its channel, in the `outage` category (the two buttons), `threadId` = the address group key (Android group + summary), `time-sensitive` on iOS when urgent, a 6-hour TTL. Chosen by `PUSH_PROVIDER=expo|log` (default `log` outside production, `expo` in production); `EXPO_ACCESS_TOKEN` optional.
- **A safety rule:** a development server (`NODE_ENV=development`) refuses a real `ExponentPushToken` with `400 real_token_not_allowed` unless `ALLOW_REAL_PUSH_IN_DEV=true`, so a local stack never pushes to someone's phone by accident (the mirror of the existing rule that production refuses `dev-token:`). `.env.example` documents the three variables.
- The channel ids moved to `packages/shared` (`NOTIFICATION_CHANNELS`, `channelForKind`, `URGENT_CHANNEL`, `OUTAGE_CATEGORY`, `NOTIFICATION_ACTIONS`), so the server's push and the app's device agree by construction.

**App (`apps/mobile`)**, with `expo-notifications` 58.1.7, `expo-task-manager` 58.0.12, `expo-constants` 58.0.14 (`npx expo install`), the config plugin (a white bolt as the status-bar icon, lime tint, default channel `new`):

- `src/notifications/channels.ts`: the five Android channels created at start and renamed on every language or script change: `new` "Nova isključenja", `evening_before` "Podsetnik uveče", `changed` "Izmene", `cancelled` "Otkazano" (default importance) and `hitno` "Hitno" (high; **Do Not Disturb respected, no bypass**, as decided), each with a Serbian description that shows in the system settings; the `outage` category with **Detalji** and **Dodaj u kalendar**; the foreground handler (a notification that arrives while the app is open is shown).
- `src/notifications/respond.ts`: a tap on a notification or on a button opens the outage detail (`/outage/<id>`, with the address), also from a cold start; **Dodaj u kalendar** opens the detail with the system add-event screen over it (the calendar needs an activity, as decided).
- `src/notifications/token.ts`: the real Expo push token when the build has an EAS project id (`extra.eas.projectId`, written by `eas init`), else the development token as before; never throws.
- The gallery (development only) has a **notifications lab** (`strujaalert://gallery?section=notifications`) that posts local notifications shaped like the server's pushes, so all of this can be tried without a server or FCM.

## Verified on the emulator (`Pixel_10_Pro`, Android 17, the mock API)

Screenshots in `docs/screens/android/phase4/`.

| Check                                                                                     | Result                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The five channels exist on the device with the right names, importances and no DND bypass | `dumpsys notification`: `new`/`evening_before`/`changed`/`cancelled` importance 3, `hitno` importance 4, `mBypassDnd=false`, Serbian names                                                                                                                        |
| A notification on its channel, with the two buttons, lime tint, grouped by address        | `01-new-channel-with-actions.jpg`: "Detalji", "Dodaj u kalendar"; `channel=new`, `groupKey=address-1`, the library adds the group summary                                                                                                                         |
| Tap from a **killed** app (background kill, as a swipe from recents)                      | `02-detail-opened-from-killed-app.jpg`: the app starts straight on the outage sheet with its content                                                                                                                                                              |
| "Dodaj u kalendar" from the shade                                                         | The app opens on the detail and launches the calendar intent; on this emulator it resolved to Google Calendar's sign-in (no Google account on the AVD), which is the system's calendar taking over: verified up to the handover, the saved event is a phone check |
| Three for one address                                                                     | `03-group-collapsed.jpg`, `04-group-expanded.jpg`: one group with a "2" summary, the urgent one pulled out on top as a heads-up by Android                                                                                                                        |

Two things found and fixed while doing it: Android's `force-stop` also clears the app's notifications (so the killed-app test uses a background kill, which is what swiping from recents does), and a channel `sound: 'default'` means a bundled file to expo-notifications (warning; removed: the system default sound applies).

**Not verified here (needs the real push):** FCM delivery, the receipts job against Expo, quiet hours end to end (the server logic is unchanged and tested), and anything on your phone.

## Tests and gate

`pnpm lint` 0 warnings · `pnpm typecheck` green (incl. iOS) · `pnpm test` green, exit 0: mobile **354** jest (+11: channels in three scripts, the category, where a tap leads, the token fallback) + 23 contract (6 live skipped) · server **261** (+5: the Expo message shape, chunking and error tickets, a failed chunk, receipts; the real-token guard in the API test) · parser 174 · shared 23 · scripts 62.

## Side effects to know about

- `apps/mobile/eas.json` appeared (written by the Expo tooling during the install; the standard build profiles). Kept; harmless; `eas init` will use it.
- `pnpm-workspace.yaml`: three packages added to `minimumReleaseAgeExclude` by pnpm for the new dependencies.
- A native rebuild was needed (three native modules and the plugin): done for the emulator (x86_64). **Your phone needs a new arm64 build** before the first real push (step "C" done → I build and install it).

## Next (waiting for you)

A to D of the plan §0, then `eas init` with you present; then the first real push to the phone: one of each kind, "Hitno", the buttons, grouping and quiet hours, with the app closed, times logged (plan §5). After that, step 3 (the data push and the headless task).
