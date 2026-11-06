# Platform builds

The interface and Stockfish WebAssembly worker are shared. Windows uses Electron with context isolation and a sandboxed renderer; Android uses Capacitor with a local HTTPS WebView origin.

## Windows

Run `Build-Windows.bat` or `npm run package:win`. This uses Electron for the app directory and Inno Setup 6 for the installer. The scripts prepare assets and build the current interface before packaging. On npm versions that disable dependency install scripts, explicitly run `node node_modules/electron/install.js` before launching or packaging.

`electron/main.cjs` owns the narrow native bridge. Renderer code has no Node access. Chess.com requests are restricted to the documented HTTPS public API. API keys are encrypted with Electron safeStorage for the current Windows user. Keys are never returned to the renderer after saving. Changing the configured endpoint discards the saved key, avoiding accidental disclosure to a different service.

The bundled Foxash 1.4.0 runtime executes the bundled `review.foxash` and `training.foxash` scripts. Review rules choose move labels and key moments; training rules choose coaching focus, queue priorities and repeat intervals. Both bridges validate input/output and use isolated temporary directories. Custom coaching packs contain numeric review thresholds, not executable scripts. The original Foxash repository is not modified.

`node scripts/package-smoke.mjs` launches a hidden isolated development profile and tests the preload bridge, a real Foxash classification change, API allowlisting and credential storage. This is separate from end-to-end interface and installed-package verification.

Existing Windows downloads are unsigned. Local builds can use a trusted certificate via `CHESSASH_SIGNING_THUMBPRINT` and `Build-Windows.bat -RequireSigned`; see [SIGNING.md](SIGNING.md). The app, installer and uninstaller are signed when configured. No trusted certificate is installed on the development PC yet, so signed output has not been verified. SmartScreen reputation warnings can persist even with a valid signature.

The Windows package targets x86-64. The bundled Foxash executable has the matching x64 architecture. This is a target declaration, not a claim that every processor or native ARM64 execution has been tested.

The desktop board uses available width and short windows scroll vertically. The main header stays pinned on both platforms. V1.3 tightens the space above the review board and updates movement, capture and feedback animations while preserving reduced-motion support.

## Android

Prerequisites: Node 22+, JDK 21, Android SDK platform 36, SDK build tools and an Android device or emulator for runtime verification.

The project sets minimum Android API 24. Stockfish also requires a recent Android System WebView with WebAssembly support; an old OS version alone does not establish engine compatibility. Earlier runtime verification used an Android 16/API 36 x86_64 emulator. The author reports that v1.2 works on Android; the agent's v1.2 interface checks used a phone-sized Electron viewport, not a physical device.

The source archive does not include downloaded SDKs or Gradle caches. Install Android Studio/SDK from the official Android Developers site, use SDK Manager to install platform 36 and build tools, set `ANDROID_SDK_ROOT` to that SDK directory and `JAVA_HOME` to JDK 21, then use the commands below. The project also supports a project-local SDK at `work/android-sdk` when supplied. Do not assume the author's local SDK path exists after extracting source elsewhere.

Run `Build-Android.bat` for a signed release or `Build-Android.bat -Debug` for a debug APK. Set `JAVA_HOME` and `ANDROID_SDK_ROOT` to your installations if they differ from the local defaults. SDK, Gradle caches, emulator data and downloaded tools live in `work/`; these are build tools, not release assets.

`npm run android:release` prepares the interface and creates the release APK. It generates a new project-local self-signed signing key only when none exists, then reuses it for subsequent builds. This is an app update identity, not verified publisher code signing. The release APK is suitable for sideloading; Play Store publishing is a separate workflow.

The signing key is `.private/android-release.jks`; its randomly generated password is stored as `.private/android-signing-password.dpapi`, encrypted for the current Windows account. Both files are excluded from source control and must remain together. Do not delete or replace them if you want future APKs to update the installed app. The DPAPI password file is tied to this Windows account and machine: a portable backup requires recovering the password locally and storing it separately in a password manager before moving machines. Never upload `.private/` with public source or send its contents in chat. Back up the keystore and password securely.

The debug APK uses a different key. Replacing a debug install with a release install requires uninstalling the debug app first, which clears its local library. Export any games you want to keep before doing that. The build script refuses partial/mismatched signing file state rather than overwriting an existing key.

The Android file plugin invokes the system document picker for PGN exports, avoiding WebView blob-download limitations and broad storage permissions. PGN imports use the WebView's file picker. Network imports use Capacitor HTTP and saved reviews run without a network connection.

Android supports the shared training interface, local Stockfish grading and separate practice history. Matching TypeScript defaults provide review and training decisions; the Windows Foxash executable is not used on Android. Tests compare its training focus, priorities and repeat intervals against the actual Foxash runtime.

## V1.3 verification and release state

Release source is version 1.3.0 with Android code 6. Current unit tests pass (84 passed, one optional network test skipped), and the interface build and real-engine Windows training UI check pass. Full app restart, source-position navigation and persistent progress checks also pass. These checks cover EN/IT and a 390px viewport, with original reviews and notes preserved. They do not establish physical Android or installed-upgrade behaviour. Fresh packages are produced by the build commands above.

## Sources

- Android SDK download and checksum: https://developer.android.com/studio
- Capacitor environment requirements: https://capacitorjs.com/docs/getting-started/environment-setup
- Capacitor Android project workflow: https://capacitorjs.com/docs/android

SDK command-line tools downloaded from Google's official repository: `commandlinetools-win-15859902_latest.zip`; SHA-256 `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a` verified before extraction.

Current build and runtime results are recorded in STATUS.md. Do not infer device verification from compilation success.

## Foxash source

Foxash by FlameDev Studios: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/). Windows bundles the runtime and corresponding source archive.
