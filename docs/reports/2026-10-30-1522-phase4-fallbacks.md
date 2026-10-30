# Phase 4: the watchdog threshold, exact alarms, the HONOR card, the companion push and the 15-minute refresh

Date: 2026-10-30. Branch `main`. `aeb4c94` and `c21e70f` are **pushed**, as approved. This report's commit is **not pushed**. The phone has the new build installed (details below); the local stack is up on the new server code.

## 1. Collector watchdog: fewer than two slots is the alarm

`collect-watch.yml` now fails and opens (or comments on) the `collector` issue when the last whole Belgrade day has fewer than **two** of its three slots (`MIN_SLOTS_PER_DAY` in `scripts/src/collector/watch.ts`); the issue title is "Collector: too few EDS fixtures on <date>". Tests cover 0, 1, 2 and 3 slots. The threshold is one constant.

## 2. The two confirmations

Encoded as reviewed, dated today, no change needed: "Старе Железничке Колоније" → the neighbourhood Железничка колонија (not Нова железничка колонија), and Бојанине воде as a locality of Niška Banja.

## 3. Exact alarms (recommendation 1, as approved)

- `android.permission.SCHEDULE_EXACT_ALARM` is declared in `app.json` (optional on Android 12+: off until the person turns it on; the battery allowlist grants it too). `USE_EXACT_ALARM` is not used.
- `src/notifications/exactAlarms.ts` reads the state through expo-notifications (`getExactAlarmPermissionsAsync`) and asks through `requestExactAlarmPermissionsAsync`, which opens the system's "Alarms & reminders" screen for the app. Below Android 12 it is "allowed" without asking.
- **One row on Podešavanja** under notifications, shown only while the state is "denied": "Alarm za početak isključenja — Približan: može da zakasni do sat vremena. Dozvolite tačne alarme da stigne u minut." with the button "Dozvoli tačne alarme". The state is re-read whenever the app comes back to the front. Nothing in onboarding.

## 4. The HONOR / Huawei card (as approved)

`src/notifications/vendor.ts` reads the maker from `Platform.constants.Manufacturer`; on HONOR and Huawei the card appears **on Podešavanja** (notifications section) and **on Početna under the "notifications off" banner**, nowhere else and on no other maker. Copy: "Obaveštenja na HONOR i Huawei telefonima — Da bi „Bez struje“ stizalo u minut i kad je aplikacija zatvorena: Podešavanja → Baterija → Pokretanje aplikacija → Struja Alert → isključite „Upravljaj automatski“ i uključite sve tri opcije; zatim Baterija → Neograničeno." The button "Otvori pokretanje aplikacija" opens the system manager's App launch list (HONOR's `com.hihonor.systemmanager`, then Huawei's `com.huawei.systemmanager`), falling back to the app's own settings page; the card carries the exact-alarm button too while that state is "denied". Advice, never a gate. `BOUNDARY_SINK=fcm` stays off.

Seen on your phone (`docs/screens/android/phase4/10-honor-card-podesavanja.png`): the card on Podešavanja; the exact-alarm row is hidden because the allowlist grants exact alarms there.

## 5. The changed-outage gap, closed two ways (as approved)

**The companion push (server).** Every "Izmena", "Otkazano" and "reinstated" row now also gets a **data-only companion**: the notification's own `data` (outage id, kind, the new window, the address), no title or body, high priority, an hour of TTL. It goes out **at once** (the visible notification may wait for 07:00 in quiet hours; the alarm correction does not), and **even when the person turned the kind off** (`suppressed`: the alarm must be right regardless). Each row gets at most one (`notification_log.companion_sent_at`, migration `0012`; a failed send is retried on the next tick for six hours; a dead token drops the device as before). The deliverer sends the companions before the visible notifications. The log provider prints them as `data-only`. Tests: the companion for a changed outage, none for a "new", one for a suppressed kind, never twice; the silent Expo message shape.

**On the phone.** Nothing new to receive: the background task already handles a data push with `outageId`/`kind` as an alarm-book update (`bookFromPush` → `syncAlarms`), proven to run with the app killed and in Doze (15 of 15 today). The jest test "the companion push of a change (the app killed)" drives the real `syncAlarms` against the notification mock: the 13:00 alarm is cancelled, the 15:00 one booked, nothing stays at 13:00; "Otkazano" cancels and takes "Bez struje" down.

**The second line: a 15-minute refresh.** `expo-background-task` (installed with `npx expo install`, its config plugin added) runs `struja-alert-refresh` (`src/notifications/refresh.ts`): fetch the addresses and their outages, rebuild the book from that answer alone, make the alarms match. Registered after onboarding with `minimumInterval: 15`; Android runs it through WorkManager at its own pace (not before 15 minutes, often later, not in Doze), so it is the backstop, not the clock. Defined at module scope in `index.ts` beside the push task. Tests: a refresh rebuilds the book and syncs; no addresses means nothing; a failed fetch leaves the book alone; the registration.

**The step 6 checklist** (`docs/phase4-plan.md` §5) has three new rows: the changed outage with the app killed (13:00 → 15:00 by the fixtures; nothing fires at 13:00; the companion's task line; then with the server stopped after the scrape, the refresh line within 15–30 min), the exact-alarms row, and the HONOR card. §8 has decisions 13–15.

## On the phone now

New debug APK built (the native project gained `expo-background-task` and the permission) and installed with `phone-session --install`. Checked with adb: `SCHEDULE_EXACT_ALARM` is in the installed package; `TaskManagerModule.xml` lists both tasks (`struja-alert-push`, `struja-alert-refresh`); a WorkManager job for the app is scheduled; the HONOR card renders (screenshot). Not run today: the 13:00 → 15:00 phone test itself (step 6, as you said). Note: the reinstall put the app on the battery allowlist again (as every adb install does); your full settings are otherwise as you set them. The server was restarted on the new code with migration 0012 applied; Metro was restarted (the prebuild had taken the old one down).

## Tests and gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · tests: mobile **389** jest (+11) and 24 contract, server **279** (+2), scripts **66** (+1), parser 178, shared 23. One full run, exit 0.

## Decisions needed

1. Whether to push this commit.
2. Nothing else: the watchdog threshold, the alias, the locality and the four fallback decisions are done as you said.

Next: the widget (step 4).
