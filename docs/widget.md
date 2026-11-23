# The home screen widget (Android)

`apps/mobile/modules/struja-widget`: a local Expo module, Kotlin, Jetpack Glance (androidx.glance 1.2.0). Two widgets: **Struja Alert** (2×2, the primary address) and **Struja Alert – adrese** (4×2, up to three addresses). BRIEF §7; decided 30 Oct 2026 (`docs/phase4-plan.md` §8, decision 16) after `expo-widgets` turned out unable to open the app from a tap on Android.

## What it shows

Per address, decided **natively at render time** from the outage windows and the clock (`WidgetStore.view`):

| State      | When                                   | Title (sr-Latn)       | Second line               | Fill                  |
| ---------- | -------------------------------------- | --------------------- | ------------------------- | --------------------- |
| `ACTIVE`   | an outage is running now               | Bez struje            | povratak u 18:15          | red, white text       |
| `IMMINENT` | the next start is within 24 h          | Danas / Sutra bez struje | 13:15–18:15            | orange, near-black    |
| `UPCOMING` | the next start is later                | Sutra bez struje / Bez struje | (pon 2.) 13:15–18:15 | yellow, near-black |
| `CLEAR`    | nothing coming                         | Sve u redu            | –                         | lime, near-black      |
| empty      | no snapshot or no address              | Dodajte adresu        | Otvorite aplikaciju       | the card colour       |

The small widget is one flat status fill with the address name, the title and the time line (the design's hero card). The medium one is a card with one row per address: name and time line on the left, the status word as a filled pill on the right. "Moguće pogođeno" is a third line / a suffix when the match was not certain. Flat fills, radius 20, no outlines; the system font (RemoteViews cannot load Onest); every size in sp, so the system font scale applies. Light and dark through day/night colour providers from the app's palettes.

## Data flow (no polling of its own)

The app hands over a **snapshot** (`src/widget/snapshot.ts`): the saved addresses (`widget-addresses` in MMKV, written at every sync) with their coming outages from the alarm book (cancelled and past ones left out) and every label in the person's language and script. It goes to the native side (`setSnapshot`, SharedPreferences) from the same three paths that keep the alarms right: the sync in the running app (`useOutageAlarms`), the push task (every data push, the companion of a change or a cancellation included) and the 15-minute refresh. "Delete all my data" clears it.

**The status flips at the start and the end with the app dead:** every render schedules one AlarmManager alarm (`WidgetTick`) for the next outage start or end, or midnight (the day words), exact when the app may schedule exact alarms, else with the system's window; the alarm re-renders both widgets, which schedule the next one. The server's data push at the boundary re-renders too (7–12 s later on the phone), so the alarm is the floor, not the only path.

## Tap

`actionStartActivity` with a deep link: `strujaalert://outage/<id>?addressId=<subscription>` when the address has a current or next outage, else `strujaalert://` (Početna). The app's router handles both from a cold start.

## Testing

Jest: the snapshot builder and the refresh wiring (`__tests__/widget.test.ts`). The rendering is checked by eye: the widgets placed on the emulator's and the phone's home screens, light and dark, font scale 1.0 and 2.0, screenshots in `docs/screens/android/phase4/`. Maestro cannot see widgets.
