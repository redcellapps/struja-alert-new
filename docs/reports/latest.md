# Phase 4, step 3 on the phone: the data push, the headless task and the local alarms under two MagicOS settings

Date: 2026-10-30. Branch `main`. `0a2a416` and `c3cd714` are **pushed**, as approved. This report's commit (the alarm-book fix, the group key, the task logging, the push tool's timestamps, this report) is **not pushed**. Phone: HONOR Magic6 Lite 5G (ALI-NX1), Android 15, MagicOS, on USB the whole time. Debug build of `c3cd714` installed with `phone-session --install`; the bundle from Metro over `adb reverse`. Server with `PUSH_PROVIDER=expo`, `BOUNDARY_SINK=expo`, `ALLOW_REAL_PUSH_IN_DEV=true`; subscription 40 = Trebinjska (whole street, "Moguće pogođeno"), real `ExponentPushToken`; fixtures shifted so today's Trebinjska outage ran 13:15–18:15 (13:25–18:25 after the second shift).

How it was measured. _Sent_ is the server's `sent_at` for an ordinary notification and the push tool's "sending at" for a signal. _Task_ is the headless task's own logcat line (`[struja-push] … task ran`, added for this). _Shown_ is the notification's `when` in `dumpsys notification`. States: "swiped" = the app opened, then swiped away from recents (a process FCM started has no recents card; where the swipe left the process alive, `am kill` was used and it says so); "am kill" = what the system does under memory pressure; "Doze" = `am kill`, screen off, `dumpsys deviceidle force-idle` (deep idle, confirmed `IDLE` after each push). The ordinary notification is `dev:push changed --outage 448` (on "hitno", because the outage was running). The signals are `dev:push started|ended --outage 448` through Expo's push service (one data-only push per address).

## Setting 1: Battery "Optimized", App launch "Manage automatically" on (12:49–13:16)

One correction first: the reinstall put the app back on MagicOS's battery allowlist (`dumpsys deviceidle whitelist` listed it as a _user_ entry again, as in round 1), so Android would have treated it as "Unrestricted". I removed the entry with adb at 12:41 so the round matches the setting you named.

| State                                                                   | Push          | Sent            | Task ran     | Shown        | Delay task / shown       | Who showed it                                                            |
| ----------------------------------------------------------------------- | ------------- | --------------- | ------------ | ------------ | ------------------------ | ------------------------------------------------------------------------ |
| swiped, screen on                                                       | started (505) | 12:51:04.393    | 12:51:11.629 | 12:51:11.808 | 7.2 s / 7.4 s            | task; FCM started the process                                            |
| process alive after that, screen on                                     | ended (505)   | 12:51:33.339    | 12:51:42.547 | 12:51:42.725 | 9.2 / 9.4                | task; "Bez struje" replaced by "Struja se vratila"                       |
| am kill, screen on                                                      | started       | 12:52:07.788    | 12:52:14.966 | 12:52:15.119 | 7.2 / 7.3                | task; new process                                                        |
| am kill, screen on                                                      | ended         | 12:52:26.435    | 12:52:33.093 | 12:52:33.284 | 6.7 / 6.8                | task; new process                                                        |
| am kill, screen off, forced Doze                                        | started       | 12:52:48.287    | 12:52:59.849 | 12:53:00.059 | 11.6 / 11.8              | task; Doze stayed IDLE                                                   |
| same                                                                    | ended         | 12:53:10.032    | 12:53:21.306 | 12:53:21.538 | 11.3 / 11.5              | task                                                                     |
| real tick at `starts_at` 13:15, swiped, screen off, 20 min natural idle | started       | tick 13:15:11.0 | 13:15:19.091 | 13:15:19.259 | 8.1 / 8.2 after the tick | task; **the local alarm set for 13:15:00 had not fired** (see finding A) |

Ordinary notifications under this setting were measured in rounds 1 and 2 (2 to 3 s in all three states) and were not repeated.

## Setting 2: Manage automatically off, Auto-launch + Secondary launch + Run in background on, Battery "Unrestricted" (13:58–14:20)

| State                                 | Push               | Sent         | Task ran     | Shown        | Delay task / shown | Who showed it                       |
| ------------------------------------- | ------------------ | ------------ | ------------ | ------------ | ------------------ | ----------------------------------- |
| swiped, screen on                     | ordinary (changed) | 13:58:28.028 | –            | 13:58:31.575 | – / 3.5 s          | system (expo-notifications, native) |
| swiped, screen on                     | ordinary, retry    | 14:02:00.693 | –            | 14:02:04.096 | – / 3.4            | system                              |
| swiped, screen on                     | started            | 14:04:55.113 | 14:05:02.135 | 14:05:02.259 | 7.0 / 7.1          | task                                |
| swiped, screen on                     | ended              | 14:07:04.958 | 14:07:11.617 | 14:07:11.781 | 6.7 / 6.8          | task                                |
| process alive (JS running), screen on | ordinary           | 14:08:51.733 | –            | 14:08:54.512 | – / 2.8            | system                              |
| am kill, screen on                    | ordinary           | 14:11:04.133 | –            | 14:11:07.635 | – / 3.5            | system                              |
| am kill, screen on                    | started            | 14:12:39.009 | 14:12:47.134 | 14:12:47.309 | 8.1 / 8.3          | task                                |
| am kill, screen on                    | ended              | 14:14:14.273 | 14:14:25.762 | 14:14:25.957 | 11.5 / 11.7        | task                                |
| am kill, screen off, forced Doze      | ordinary           | 14:16:04.981 | –            | 14:16:08.437 | – / 3.5            | system                              |
| same                                  | started            | 14:17:39.701 | 14:17:51.676 | 14:17:51.895 | 12.0 / 12.2        | task                                |
| same                                  | ended              | 14:19:15.996 | 14:19:27.546 | 14:19:27.788 | 11.6 / 11.8        | task                                |

**Reading.** The setting made no difference to delivery: every push arrived in every state under both settings. Ordinary notifications take 3 to 4 s; the data push takes 7 to 12 s because the headless process must load the JavaScript bundle before the task can run (a debug bundle of 2375 modules from Metro over USB; a release build loads from disk, so expect less), and forced Doze adds about 4 s. Every "Bez struje" appeared and every "Struja se vratila" replaced it. The local alarm was never needed as a fallback: the push always came first.

**Alarms exact or not.** Setting 1: after the app left the battery allowlist, the alarms it set carried `window=+1h0m0s0ms` (inexact), and at 13:15 the push arrived before the alarm had fired. Setting 2: the alarms set after the change carry `window=0 exactAllowReason=allow-listed flags=0x9` (exact, allow-while-idle). Alarms set under setting 1 stayed inexact until something rescheduled them (the second fixture shift did, after a pull-to-refresh).

## Findings

- **A. Exact alarms depend on the battery allowlist.** expo-notifications schedules with `setExactAndAllowWhileIdle` only when `canScheduleExactAlarms()` is true (`ExpoSchedulingDelegate.kt`), else `setAndAllowWhileIdle` with a window of up to an hour. The app's manifest has neither `SCHEDULE_EXACT_ALARM` nor `USE_EXACT_ALARM`, and on Android 13+ the exact-alarm app-op is denied by default unless the app is on the battery allowlist. So under "Optimized" the "Bez struje" alarm can be up to an hour late; under "Unrestricted" it is exact. Recommendation 1 below.
- **B. A bug found and fixed on the phone.** The first alarm book carried over outages the server no longer listed, and booked "Bez struje" for a replaced row (87, 13:00). Now the sync is the whole truth of the book: what the server stops listing leaves it, with its alarms. Verified on the phone (the stale 13:00 alarms were cancelled after the reload) and in the tests.
- **C. Notification pushes never run the task on this phone.** 0 of 5 ordinary pushes ran it (swiped, killed, Doze, and once with the JavaScript instance alive); all 15 data-only pushes did. For a notification push there was no bundle request at Metro and no JavaScript line from the process; the notification itself is drawn by expo-notifications' native side. The code path in expo-notifications 58 (`FirebaseMessagingDelegate.onMessageReceived` → `runTaskManagerTasks`) is unconditional, so the cause is further down (not found today). Consequence: the alarm book is not updated from `new`/`changed`/`cancelled` pushes while the app is closed, only at the next sync (opened or brought to the front). Gap: a changed outage keeps its old-time alarm until the app is opened. Options for step 6: a data-only companion push for `changed`/`cancelled` (cheap, proven path), or a server-side cancel of the start signal for a replaced row (the tick already signals only live rows). Not decided here.
- **D. Group key mismatch, fixed.** The server grouped by street id (`address-3151`), the app's own notifications by subscription id (`address-40`), so the shade did not stack them together. Both now use the subscription id (one key per saved address, which also keeps two saved addresses on one street apart). One server test updated.
- **E. Tooling.** `dev:push started|ended` picks the newest Trebinjska outage without `--outage` (505, 2 Nov, on the first send), so `--outage` was used; it now prints "sending at" and "accepted at". Metro started with `CI=1` does not watch files ("reloads are disabled"); restarted without it. The reopened app does not refetch within React Query's stale time; a pull-to-refresh does.
- **F.** The device has no native FCM token on file (it registered before this build; the app sends one only at registration). The Expo sink does not need it.

## Recommendations

1. **Exact alarms.** Add `SCHEDULE_EXACT_ALARM` as an optional permission (declared in the manifest; on Android 13+ it is off by default and the person turns it on in "Alarms & reminders", one tap from a settings screen the app opens with `ACTION_REQUEST_SCHEDULE_EXACT_ALARM`). `USE_EXACT_ALARM` is out, as you said. Where to ask: not in onboarding. The push is the primary path and arrived every time; the alarm is the fallback for the case the push does not come. So: a small card on Podešavanja under notifications, "Alarm za početak isključenja: tačan / približan (do 1 h)", with the button that opens the system screen, shown only when `canScheduleExactAlarms()` is false; and the same line in the MagicOS card (3). Without the permission the fallback stays, inexact. The app then also calls `getPermissionsAsync` to know the state. Cost: one manifest line, one settings row, one test.
2. **`BOUNDARY_SINK=fcm` is not needed now.** Expo's path delivered 15 of 15 data pushes in every state under both settings, 7 to 12 s, and the delay is the headless bundle load, not the transport. Keep the sink as the fallback it was built as (behind the flag, with the native token field), do not enable it, and do not spend more on it before a release build is measured. If a release build still shows 7 s or more, the cost is in the task, and FCM-direct would not help.
3. **What the app should ask on first launch.** Nothing about battery in onboarding: the measurements say the default MagicOS settings deliver every push. The card belongs on Podešavanja (and behind the "notifications off" banner), shown only on HONOR/Huawei builds (`Build.MANUFACTURER`), worded as advice, not a requirement: "Da bi „Bez struje" stizalo tačno u minut i kad je aplikacija zatvorena: Podešavanja → Baterija → Pokretanje aplikacija → Struja Alert → isključite „Upravljaj automatski"; i Baterija → Neograničeno", with the button to the App launch screen (the intent if it resolves, else the app's settings page) and the exact-alarm button of (1). The first-run default is good enough for the pushes; the card is for the alarm's exactness and for the force-stop case, which no setting fixes.

## Tests and gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · tests: mobile 378 jest and 24 contract (6 live skipped), server 276, parser 174 (+3 todo), shared 23, scripts 62. Changed in this commit: `bookFromSync` drops the carry-over (test updated), the task logs its run and its errors, the server's group key is the subscription id (test updated), `dev:push` timestamps.

## Left on the phone

The test notifications ("Struja se vratila" for 448 and 505, the last "Izmena") are in the shade; the app is on the battery allowlist and the full settings as you set them; Doze unforced; the alarms for the shifted outages (13:25/18:25, exact) are booked. The server, Metro and the tunnels are still up.

## Decisions needed

1. Whether to push this commit.
2. Recommendation 1 (the optional exact-alarm permission and the Podešavanja row): yes or no; if yes, it goes into step 6 with the MagicOS card.
3. Finding C's gap (a changed outage's old-time alarm until the app is opened): the data-only companion push, or leave it for step 6's session.

Next, as you said: the Phase 1 gate (collector and village names), then the widget (step 4).
