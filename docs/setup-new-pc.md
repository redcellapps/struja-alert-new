# Setting up a new Windows PC

From a clean Windows 11 PC to "the app runs on the emulator and on my phone against the local server". Versions are the ones installed on the old PC on 23 Nov 2026 (the dev box that built Phases 1 to 4). Newer patch versions are fine unless a line says otherwise.

No values in this file: every secret is named with where it comes from, never its content.

## 1. Tools and exact versions

| Tool              | Version on the old PC                                                          | Notes                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git for Windows   | 2.54.0                                                                         | Includes Git Bash. The repo forces LF (`.gitattributes`), no `core.autocrlf` setting needed.                                                        |
| Node.js           | 24.15.0                                                                        | `.nvmrc` says `24`; `package.json` `engines` needs `>=24.3`. The Windows installer is fine (no nvm on the old PC).                                  |
| pnpm              | 12.14.0                                                                        | Pinned by `packageManager` in `package.json`. Installed with `npm i -g pnpm@12.14.0` (corepack works too).                                          |
| JDK               | Microsoft Build of OpenJDK 17.0.20.1 (17.0.20.101-hotspot)                     | `JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`, its `bin` on the PATH.                                                              |
| Android Studio    | 2026.2                                                                         | Only for the SDK Manager and the AVD Manager.                                                                                                       |
| Android SDK       | `ANDROID_HOME=C:\Users\<you>\AppData\Local\Android\Sdk`                        | `platform-tools` and `emulator` on the PATH. Packages below.                                                                                        |
| Docker Desktop    | 4.95.0 (Engine 29.8.2, Compose v5.6.0), WSL 2 backend                          | WSL 3.0.5.0. Image `postgis/postgis:18-3.6` (pulled by compose).                                                                                    |
| eas-cli           | 25.3.0 installed globally, **but `apps/mobile/eas.json` requires `>= 27.1.0`** | Install the current one: `npm i -g eas-cli@latest` (27.1.0 or newer). Only needed for EAS builds and credentials, not for local dev.                |
| GitHub CLI (`gh`) | 2.103.0                                                                        | `gh auth login` (HTTPS) for pushing and the workflows.                                                                                              |
| Maestro           | 2.12.0, unzipped to `C:\tools\maestro`                                         | Only for `qa-screens` (step 11). Set `MAESTRO_BIN=C:/tools/maestro/bin/maestro.bat` or put `C:\tools\maestro\bin` on the PATH. Needs the JDK above. |
| Gradle            | 9.4.1                                                                          | Comes with the wrapper of the generated `apps/mobile/android/`; nothing to install.                                                                 |

### Android SDK packages (SDK Manager > "Show package details", or `sdkmanager`)

The build reads these from React Native 0.88 (`node_modules/react-native/gradle/libs.versions.toml`): `compileSdk 37`, `targetSdk 36`, `minSdk 24`, `buildTools 37.0.0`, `ndkVersion 27.1.12297006`, Kotlin 2.2.0.

| Package                                                   | Version on the old PC        |
| --------------------------------------------------------- | ---------------------------- |
| `platform-tools`                                          | 37.0.1                       |
| `emulator`                                                | 37.2.12                      |
| `cmdline-tools;latest`                                    | 23.0                         |
| `platforms;android-37.0`                                  | required (compileSdk 37)     |
| `platforms;android-36`                                    | installed (targetSdk 36)     |
| `build-tools;37.0.0`                                      | required (36.0.0 also there) |
| `ndk;27.1.12297006`                                       | required                     |
| `cmake;3.22.1`                                            | required (native modules)    |
| `system-images;android-37.0;google_apis_playstore;x86_64` | revision 7 (for the AVD)     |

Gradle downloads anything missing on the first build if the licences are accepted (`sdkmanager --licenses`), but installing them up front is faster and shows problems earlier.

### The AVD

Name **`Pixel_10_Pro`** (the scripts and reports assume it; it shows up as `emulator-5554`):

- Device profile Pixel 10 Pro (`pixel_10_pro`, 1280 x 2856, 480 dpi)
- System image Android 37.0 (API level 37), Google Play, x86_64
- RAM **2048 MB** (`hw.ramSize=2048`), internal storage 10 GB

Keep RAM at 2 GB: the PC also runs Docker and Gradle (see section 3).

## 2. Windows settings

- **Long paths on**: `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1` (needs admin, then a restart).
- **Clone to a short path: `C:\sa`**. Ninja/CMake still fail past 260 characters. `apps/mobile/plugins/with-short-cxx-dir.js` also puts the CMake staging dir at `C:/b` (override with `STRUJA_CXX_DIR`); `C:\b` is created by the build.
- Keeping the same path `C:\sa` also keeps Claude Code's project folder name (`C--sa`, section 6).

## 3. Memory caps: `.wslconfig` and Gradle/Kotlin

Docker (WSL 2), the emulator and Gradle run on the same machine; without these caps they ran it out of memory.

`C:\Users\<you>\.wslconfig` (create it, then `wsl --shutdown` and restart Docker Desktop):

```ini
[wsl2]
memory=4GB
swap=2GB
processors=4

[experimental]
autoMemoryReclaim=gradual
sparseVhd=true
```

Gradle and the Kotlin daemon are capped by `apps/mobile/plugins/with-gradle-memory.js` (listed in `app.json`), which writes into the generated `apps/mobile/android/gradle.properties` at every `expo prebuild`:

```properties
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m
kotlin.daemon.jvmargs=-Xmx1g
```

Nothing to set by hand; there is no `~/.gradle/gradle.properties` on the old PC. After a native build, `.\gradlew --stop` (in `apps/mobile/android`) gives the memory back.

## 4. Git-ignored files the project needs

Copy them from the old PC over a private channel (USB stick, password manager), or recreate them from the source named here. Never commit them.

| File                                                | Needed for                                                                  | Where it comes from                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.env` (repo root)                                  | the server, the scripts (`--env-file-if-exists=../../.env`)                 | Start from `.env.example` (every variable is documented there). The old PC sets five: `DATABASE_URL` (same as `.env.example`, matches `docker/compose.yaml`), `ADMIN_TOKEN` (generate a new one, 16+ characters, command in `.env.example`), `ADMIN_IP_ALLOWLIST` (`127.0.0.1,::1`), `EXPO_ACCESS_TOKEN` (expo.dev > Account settings > Access tokens; a new token is fine, revoke the old PC's), `SCRAPER_CONTACT_EMAIL` (the contact address for the scraper's User-Agent, your choice). |
| `apps/mobile/google-services.json`                  | every Android native build (`app.json` > `android.googleServicesFile`), FCM | Firebase console > the project's settings > Android app `rs.strujaalert.app` > download `google-services.json`. Or copy it from the old PC.                                                                                                                                                                                                                                                                                                                                                |
| `apps/mobile/android/app/debug.keystore` (optional) | installing a new debug build over the one already on the phone              | Generated by `expo prebuild` from the template. If an install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, either copy this file from the old PC into the same place (after the prebuild) or uninstall the app from the phone first (that wipes its saved addresses).                                                                                                                                                                                                                  |

Not needed on a new PC (regenerated or rebuilt):

- `apps/mobile/android/` (generated by `expo prebuild` / `expo run:android`), `ios/`, `node_modules/`, `.turbo/`, `.expo/`, `test-results/`, `apps/mobile/modules/*/android/build/`.
- `.dev/eds/` (rebuilt by `dev:fixtures`), `.dev-metro.log`, `.dev-mock.log`.
- The local Postgres data (Docker volume `dbdata`): rebuilt by the migrations, the gazetteer import and `dev:scrape`. Subscriptions the phone registered with the old PC's server are lost; the app registers again on the next sync.
- Working screenshots in `docs/screens/android/step*/` and `design-review*/` (git-ignored by design; only the final QA set is committed).

Secrets that live elsewhere and need nothing from this PC: the FCM service account key (in EAS credentials), the Android upload keystore if one exists (EAS credentials), the GitHub Actions secret `SCRAPER_CONTACT_EMAIL` (repo settings). Log in with `eas login` and `gh auth login`.

## 5. From clone to the app running

PowerShell, in order. Docker Desktop must be running (`docker info` answers).

### 5.1 Clone and install

```powershell
git clone https://github.com/redcellapps/struja-alert-new C:\sa
cd C:\sa
# copy .env and apps\mobile\google-services.json here (section 4)
pnpm install
pnpm lint; pnpm typecheck; pnpm test
```

`pnpm test` needs Docker running (the server tests start a PostGIS container through testcontainers). The unfinished widget work is on the branch `wip/widget` (`git switch wip/widget`); `main` does not have it.

### 5.2 Local server with today's data

```powershell
docker compose -f docker/compose.yaml up -d
pnpm --filter @struja/server db:migrate
pnpm --filter @struja/server dev:import-gazetteer
pnpm --filter @struja/server dev:fixtures -- --shift=<minutes> --repeat-today
```

`dev:fixtures` re-dates the newest saved Niš snapshot to today into `.dev/eds`. The saved outages run 08:00 to 17:00; `--shift` moves them so that something is "now" (at 14:00 use `--shift=120`). Then start the server as its own process in a second window:

```powershell
cd C:\sa\apps\server
$env:NODE_ENV='development'; $env:FIXTURES_DIR='C:\sa\.dev\eds'; $env:PAGE_SOURCE='fixtures'; $env:IMPORT_GAZETTEER='true'
node --experimental-strip-types --env-file-if-exists=../../.env src/main.ts
```

(`ADMIN_TOKEN` comes from `.env`.) Ingest once from the first window: `pnpm --filter @struja/server dev:scrape`. Check: `curl localhost:3000/healthz`. `pnpm --filter @struja/mobile live-contract` runs the app's API client against it.

For real pushes to your phone from this dev server, set `PUSH_PROVIDER=expo` and `ALLOW_REAL_PUSH_IN_DEV=true` for the server process (see `.env.example`); otherwise pushes are only logged.

Without a server: `pnpm --filter @struja/mobile mock` serves the mock API on :3000 (scenarios in `CLAUDE.md`).

### 5.3 The emulator

Start `Pixel_10_Pro` (Android Studio > Device Manager, or `emulator -avd Pixel_10_Pro`), then:

```powershell
cd C:\sa\apps\mobile
npx expo run:android
```

The first build takes several minutes (prebuild, Gradle, CMake). It builds the debug app, installs it and starts Metro on :8081. The emulator reaches the server as `http://10.0.2.2:3000` (the app's default). On Android 17 the debug build needs the local-network permission to reach Metro:

```powershell
adb shell pm grant rs.strujaalert.app android.permission.ACCESS_LOCAL_NETWORK
adb reverse tcp:8081 tcp:8081
```

Later sessions: Metro only, `npx expo start --dev-client` in `apps/mobile`.

### 5.4 The phone (USB)

Full walkthrough and checklist: `docs/phone-session.md`. In short:

1. On the phone: Developer options > USB debugging on. The new PC has a new adb key, so the phone asks "Allow USB debugging?" again: accept. `adb devices` lists it as `device`.
2. Build for the phone's CPU (close the emulator first, for memory):
   ```powershell
   cd C:\sa\apps\mobile
   npx expo prebuild --platform android --no-install
   cd android
   .\gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
   .\gradlew --stop
   ```
   (`-PreactNativeArchitectures=arm64-v8a,x86_64` builds one APK for both the phone and the emulator.)
3. Metro for the phone's tunnel, in its own window:
   ```powershell
   cd C:\sa\apps\mobile
   $env:EXPO_PUBLIC_API_URL='http://localhost:3000'
   npx expo start --dev-client --port 8081
   ```
4. `pnpm --filter @struja/scripts phone-session --install`: checks the phone, the API and Metro, sets `adb reverse` for :8081 and :3000, installs the APK, grants the local-network permission and opens the app.

If something is off: `adb devices`, `adb reverse --list`, `curl localhost:3000/healthz`, `curl localhost:8081/status`.

## 6. What lives outside the repo for Claude Code

Claude Code keeps its state in `C:\Users\<you>\.claude\`. To carry it over:

| What                                                                              | Where on the old PC                                      | How to bring it over                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Memory notes for this project** (`MEMORY.md` index + one file per note)         | `.claude\projects\C--sa\memory\`                         | Copy the whole `memory` folder to the same place on the new PC. The folder name `C--sa` comes from the repo path, so clone to `C:\sa`; with another path, copy it into that path's folder (e.g. `D:\sa` becomes `D--sa`). |
| Session transcripts (optional, for `claude --resume`)                             | `.claude\projects\C--sa\*.jsonl` and the session folders | Copy along with `memory` if you want to resume old sessions; not needed to continue the work.                                                                                                                             |
| User settings (model, auto mode, enabled plugins: `expo@claude-plugins-official`) | `.claude\settings.json`                                  | Copy the file, or set them again with `/config` and `/plugin`.                                                                                                                                                            |
| User-level permission allowlist                                                   | `.claude\settings.local.json`                            | Copy, or let it rebuild as you approve commands.                                                                                                                                                                          |
| Project permissions (allow / ask lists)                                           | `C:\sa\.claude\settings.json`                            | In the repo; nothing to do.                                                                                                                                                                                               |
| Project instructions                                                              | `C:\sa\CLAUDE.md`                                        | In the repo; nothing to do.                                                                                                                                                                                               |
| Login                                                                             | `.claude\.credentials.json`                              | **Do not copy.** Log in again on the new PC.                                                                                                                                                                              |
| Plugins cache, history, telemetry, caches                                         | `.claude\plugins\`, `history.jsonl`, `cache\`, ...       | Not needed; plugins reinstall from `settings.json`.                                                                                                                                                                       |

The memory note `widget-step4-in-progress.md` says where the widget work stands; it now points at the `wip/widget` branch.
