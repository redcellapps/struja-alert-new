# Phase 4 plan written (for review, nothing built)

Date: 2026-10-28. Branch `main`. One commit after `16e071c` (pushed): this plan and this report, **not pushed**.

`docs/phase4-plan.md`: notifications, widget and Live Update on Android. It starts with your four preparatory tasks, click by click (Firebase project and `google-services.json`; the FCM service account key; the Expo account, `eas init` and the key in EAS; the HONOR phone settings), what runs in parallel, then the facts checked against the current Expo, Firebase, Android and HONOR documentation, the architecture, seven build steps, the tests, the phone verification table, the risks, the acceptance and eight questions for you.

Two facts found while writing it that you should know before deciding:

1. **Live Updates need Android 16 (API 36).** Your Magic6 Lite runs Android 15, so the promoted Live Update can only be verified on the emulator; the phone verifies the fallback (an ongoing notification with a countdown chronometer).
2. **Expo push tokens need an EAS project id**, which the app does not have yet; `eas init` binds the repository to your Expo account, so it is yours to run (or mine with you present). No EAS build is needed; the builds stay local.

Also: force-stop (and MagicOS's "Manage automatically") stops FCM delivery by Android's design; the plan answers with a scheduled local alarm at `starts_at`, a periodic background refresh, a direct-FCM fallback on the server, and a "MagicOS card" in the app whose wording is decided after the first-run measurement on your phone.

Nothing is built. Waiting for your review of the plan and the answers to its §8.
