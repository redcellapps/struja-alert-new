# Phase 4, step 3: outage started / ended, the data push, the headless task, the two fallbacks

Date: 2026-10-30. Branch `main`, on top of `0a2a416` (round 2 of step 2, **not pushed**, as before). This step's commit (code, migration, plan corrections, this report) is **not pushed** either. Built against the emulator and the tests only: nothing of this has run on the phone yet; the phone session is step 6, and your two decisions from the last report are still open (below).

## What was built

**Server**

1. **The payload** (`packages/shared/src/boundary.ts`): `{ type: outage_started | outage_ended, outageId, subscriptionId, startsAt, endsAt, possible }`, one push per affected address (a device with two affected addresses gets two). TTL 1 hour for a start, 15 minutes for an end.
2. **`ExpoBoundarySink`** (`apps/server/src/notify/boundary-sinks.ts`): the data-only message through Expo's push service: no title or body, `priority: high`, `contentAvailable` (iOS, Phase 6), the TTL. `DeviceNotRegistered` drops the device as the deliverer does; a development token is skipped and logged; a chunk failure throws, so the boundary tick releases its claim and retries a minute later (that logic existed).
3. **`FcmDirectSink`** (fallback 2, same file): the same JSON straight to FCM v1 (`projects/<id>/messages:send`, `android.priority = HIGH`, `android.ttl`), with an RS256 service-account assertion signed with Node's crypto (no Google library), the access token cached and renewed a minute before it expires. 404 `UNREGISTERED` drops the device, 429 and 5xx throw for a retry, a 400 is logged. It needs the device's own FCM registration token, which the server did not have: `POST /v1/devices` and `PATCH /v1/devices/me` take an optional **`nativePushToken`** (migration `0011_native_push_token`, `docs/api.md`). A device without one is skipped and logged.
4. **The choice**: `BOUNDARY_SINK=log|expo|fcm` (default `expo` in production, `log` elsewhere), `FCM_SERVICE_ACCOUNT_JSON` (the key file as one line, required for `fcm`, never in git), both in `.env.example`; `chooseBoundarySink` is shared by the server and the dev tool.
5. **`dev:push started|ended --subscription <id> [--outage <id>]`** now sends the signal from the tool's process through the configured sink, without touching the outage's `*_signalled_at` claim.
6. The notification push data gained `address` ("Trebinjska 34", in the device's script), so the app can book its alarm from the push alone.

**App**

7. **The entry file** `apps/mobile/index.ts` (`"main": "index.ts"`): defines the push task at module scope, then `expo-router/entry`, as expo-notifications requires for a headless load.
8. **The task** (`src/notifications/background.ts`, name `struja-alert-push`), registered after the channels exist. A finding that shaped it: on Android expo-notifications hands **every** FCM message to the task manager (`FirebaseMessagingDelegate.onMessageReceived`), in every app state, not only the data-only ones. So the task handles both: a boundary push becomes "Bez struje" / "Struja se vratila" and cancels the matching alarm; a `new`/`changed`/`cancelled`/… push updates the alarm book from its data. Both Expo's service and the direct FCM sink put the JSON under the `body` data key (`dataString` in the task payload), so one parser serves both paths. A running app also refetches its queries after any push.
9. **The surface** (`src/notifications/active.ts`): "Bez struje: Trebinjska 34 / Povratak u 16:00" on "hitno", ongoing (not swipeable), identifier `outage-<id>-active`; "Struja se vratila / Trebinjska 34" on "Izmene", identifier `outage-<id>-ended`, which takes the first one down. Step 5 puts the Live Update in front of the start one on Android 16+.
10. **Fallback 1, the alarms** (`src/notifications/alarms.ts`): an alarm book in MMKV (outage → address, window, status), filled from Početna's two queries (`useOutageAlarms` in the root layout, same query keys so nothing is fetched twice) and from pushes. `planAlarms` books the start and the end as date-triggered local notifications **with the same identifiers as the push surface**, so whichever of the push and the alarm comes second replaces the first instead of adding a line. `syncAlarms` reconciles the phone's scheduled list with the plan: cancels ours that are gone or moved, schedules what is missing, and takes down the "Bez struje" of a cancelled outage. A cancelled outage never has an alarm (tested four ways).
11. The app sends `nativePushToken` (`getDevicePushTokenAsync`) at registration when it has an EAS project id. The lab (Galerija → Obaveštenja) has two new buttons: the start signal and the end signal, as the task would show them.

## Tests and gate

`pnpm lint` 0 warnings · `pnpm typecheck` green · tests: mobile **378** jest (+24) and 24 contract (6 live skipped, +1), server **276** (+14), parser 174 (+3 todo), shared 23, scripts 62. New: `apps/server/test/boundary-sinks.test.ts` (payloads, both sinks, the JWT verified with the public key, token renewal, dead and bad tokens, retry), `apps/mobile/__tests__/alarms.test.ts`, `apps/mobile/__tests__/background.test.ts`, plus the `nativePushToken` cases in the API, device and contract tests and the config rule.

Two things about the run: the server tests need Docker Desktop, which was not running (started it); and one full `pnpm test` hit the known Windows worker crash (exit 3221226505, CLAUDE.md) in `jobs.test.ts`, which passed on the re-run of the package alone (276/276) and in the first full run.

## Plan corrections (`docs/phase4-plan.md` §3 step 3, §8 decisions 10–12)

One push per address, not per device; the native token field; "Struja se vratila" as a plain notification on "Izmene". The widget refresh (step 4) and the Live Update (step 5) hooks of the task come with those steps.

## Not done / limits

- Nothing verified on the phone: the data push's arrival time with the app killed and in Doze, and whether MagicOS lets the headless task run, are the open questions of §5 and need the phone session. The emulator can run the task; I have not built a new APK (the native project changed: the entry file and the task registration need a rebuild).
- iOS: `contentAvailable` is set, the rest is Phase 6 **[MAC]**.
- The headless task cannot be reached from Maestro; the lab buttons and `dev:push started|ended` are the manual checks.

## Decisions needed

1. Still open from the last report: apply the full MagicOS settings and tell me, for the third measurement; and whether to push `0a2a416`.
2. Whether to push this commit.
3. Step 4 (the widget, `expo-widgets`) next, or the new debug build and the data-push measurement on the phone first (my suggestion: the build and one `dev:push started` with the app swiped away, 10 minutes, before the widget).
