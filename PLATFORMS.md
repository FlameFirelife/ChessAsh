# Platform builds

The interface and Stockfish WebAssembly worker are shared. Windows uses Electron with context isolation and a sandboxed renderer; Android uses Capacitor with a local HTTPS WebView origin.

## Windows

Run `Build-Windows.bat` for the Inno Setup installer. It prepares dependencies and assets automatically. The installer keeps a stable app identity, upgrades previous installations and adds a single user PATH entry. The executable company metadata is FlameDev; the installer publisher is FlameDev Studios. On npm versions that disable dependency install scripts, explicitly run `node node_modules/electron/install.js` before launching or packaging.

`electron/main.cjs` owns the narrow native bridge. Renderer code has no Node access. Chess.com requests are restricted to the documented HTTPS public API. API keys are encrypted with Electron safeStorage for the current Windows user. Keys are never returned to the renderer after saving. Changing the configured endpoint discards the saved key, avoiding accidental disclosure to a different service.

The bundled Foxash runtime executes only the bundled review script. Custom coaching packs contain validated numeric thresholds, not arbitrary executable scripts. The original Foxash repository is not modified.

`node scripts/package-smoke.mjs` launches a hidden isolated development profile and tests the preload bridge, a real Foxash classification change, API allowlisting and credential storage. This is separate from end-to-end interface and installed-package verification.

The installer and portable executable are unsigned. Windows SmartScreen may ask for confirmation. Code signing requires a publisher certificate and is not implied by a successful build.

## Android

Prerequisites: Node 22+, JDK 21, Android SDK platform 36, SDK build tools and an Android device or emulator for runtime verification.

The project sets minimum Android API 24. Stockfish also requires a recent Android System WebView with WebAssembly support; an old OS version alone does not establish engine compatibility. Runtime verification in this session used an Android 16/API 36 x86_64 emulator. A physical phone has not been tested.

The source archive does not include downloaded SDKs or Gradle caches. Install Android Studio/SDK from the official Android Developers site, use SDK Manager to install platform 36 and build tools, set `ANDROID_SDK_ROOT` to that SDK directory and `JAVA_HOME` to JDK 21, then use the commands below. The project also supports a project-local SDK at `work/android-sdk` when supplied. Do not assume the author's local SDK path exists after extracting source elsewhere.

Run `npm run build`, `npx cap sync android`, then `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android-build.ps1`. Set `JAVA_HOME` and `ANDROID_SDK_ROOT` to your installations if they differ from the local defaults. SDK, Gradle caches, emulator data and downloaded tools live in `work/`; these are build tools, not release assets.

`Build-Android.bat` creates a fresh signed release APK. Direct `npm run android:release` also builds the current interface before packaging. It generates a new project-local self-signed signing key only when none exists, then reuses it for subsequent builds. This is an app update identity, not verified publisher code signing. The release APK is suitable for sideloading; Play Store publishing is a separate workflow.

The signing key is `.private/android-release.jks`; its randomly generated password is stored as `.private/android-signing-password.dpapi`, encrypted for the current Windows account. Both files are excluded from source control and must remain together. Do not delete or replace them if you want future APKs to update the installed app. The DPAPI password file is tied to this Windows account and machine: a portable backup requires recovering the password locally and storing it separately in a password manager before moving machines. Never upload `.private/` with public source or send its contents in chat. Back up the keystore and password securely.

The debug APK uses a different key. Replacing a debug install with a release install requires uninstalling the debug app first, which clears its local library. Export any games you want to keep before doing that. The build script refuses partial/mismatched signing file state rather than overwriting an existing key.

The Android file plugin invokes the system document picker for PGN exports, avoiding WebView blob-download limitations and broad storage permissions. PGN imports use the WebView's file picker. Network imports use Capacitor HTTP and saved reviews run without a network connection.

## Sources

- Android SDK download and checksum: https://developer.android.com/studio
- Capacitor environment requirements: https://capacitorjs.com/docs/getting-started/environment-setup
- Capacitor Android project workflow: https://capacitorjs.com/docs/android

SDK command-line tools downloaded from Google's official repository: `commandlinetools-win-15859902_latest.zip`; SHA-256 `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a` verified before extraction.

Current build and runtime results are recorded in STATUS.md. Do not infer device verification from compilation success.

## Foxash source

Foxash by FlameDev Studios: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/). Windows bundles the runtime and corresponding source archive.
