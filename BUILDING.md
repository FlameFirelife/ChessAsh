# Building ChessAsh

Run the build files from the project folder. They also work when the folder name contains spaces. Both stop on errors and wait for a key before closing. For automation, set `CHESSASH_NO_PAUSE=1`; the exit code remains nonzero if a build fails.

## Requirements

- Node.js 22 or newer with npm
- Windows installer: Inno Setup 6
- Android APK: JDK 21, Android SDK platform 36 and build tools 36

The scripts discover common installations. You can override discovery with `JAVA_HOME`, `ANDROID_SDK_ROOT` or `ANDROID_HOME`. Set `INNO_COMPILER` to the full path of `ISCC.exe` if Inno Setup is elsewhere. Optional local overrides live in `.private/build-env.json` with `javaHome`, `androidSdkRoot` and `gradleUserHome` fields. This file stays private and is not required by source checkouts.

Dependencies are installed with `npm ci` when missing or when the lockfile changes. Asset preparation and a fresh interface build run before packaging. A project build lock prevents the two build scripts from changing shared assets at the same time.

## Windows installer

```bat
Build-Windows.bat
```

Output: `release/ChessAsh-Setup-1.4.5.exe`, with the version taken from `package.json`.

Electron packages the application directory; Inno Setup creates the installer. The default installation is per user and does not need administrator rights. It adds the application directory to the user's PATH, offers a desktop shortcut and creates a Start menu entry. In a new terminal, `chessash` opens the app.

The installer uses a stable application ID. Running a newer installer updates the existing installation. Games, notes and settings remain in the application's user-data directory. Uninstall removes the PATH entry only if this installer added it. Unrelated PATH entries remain untouched. The earlier NSIS build has a separate migration check in the installer.

Installer source is in `installer/ChessAsh.iss`. Executable and installer branding comes from `package.json`, `build/release.json` and `build/icon.ico`. The default publisher is FlameDev Studios. A publisher name in file metadata does not code-sign the executable.

For a signed build, configure a trusted certificate's `CHESSASH_SIGNING_THUMBPRINT` and run `Build-Windows.bat -RequireSigned`. The build signs the app, installer and uninstaller and verifies the final installer. Without a configured identity, the default build warns and remains unsigned. There is currently no trusted Windows signing certificate installed on the development PC. See [SIGNING.md](SIGNING.md) for setup, verification and the distinction between publisher identity and SmartScreen reputation.

## Android APK

```bat
Build-Android.bat
```

Output: `release/ChessAsh-1.4.5-android.apk`. This is a release APK signed for sideloading. The script verifies the APK's signer and version metadata. `Build-Android.bat -Debug` builds a separate debug APK.

The application ID stays `dev.flamedev.chessash`. Keep the existing signing key to install future release builds as updates. A debug APK or an APK signed with another key cannot be updated in place with this release key.

APK signing does not remove every Android installation warning. The exact sideloading, Play Protect or developer-verification message determines the next step; see [SIGNING.md](SIGNING.md).

The local signing identity is `.private/android-release.jks`. Its password is encrypted for the current Windows account in `.private/android-signing-password.dpapi`. Keep both files and back them up securely. The encrypted password is machine/user bound; recover it locally into a password manager before moving the key to another machine. Never commit signing material or paste it into chat. A fresh source checkout creates its own local signing identity when none exists.

## Versioning and documentation

Set the release version in `package.json`. Increase `androidVersionCode` in `build/release.json` for every Android update. Its value must be an integer greater than the version code already installed.

`build/release.json` also sets the publisher URL, copyright text and documentation list. The installer includes the README, training guide, licence, credits, third-party notices and build/platform/signing instructions. `README_GITHUB.md` mirrors the general public repository README.

Current release source: `1.4.5`, with Android version code `8`. Release notes are in `docs/releases/V1.4.5.md`. Build fresh packages from the selected release source before publishing.

The Windows build bundles both `rules/review.foxash` and `rules/training.foxash` with Foxash 1.4.0. Android uses the matching shared default policies. Keep both scripts and the runtime resources when exporting source or packaging Windows.

## Verification

```sh
npm test
npm run build
node scripts/v13-training-smoke.mjs
```

The current checks pass 128 tests with one optional network test skipped. The training UI check uses a hidden Electron window, isolated local data, the actual Windows Foxash bridge and local Stockfish. It covers reply playback, recap counts, assisted-answer scheduling, EN/IT and a phone-sized viewport. These results do not establish a physical Android test or an installed v1.4 upgrade test.

`node scripts/v12-ui-smoke.mjs` checks the existing review flow. `node scripts/package-ui-smoke.mjs` checks `release/win-unpacked/ChessAsh.exe`; run it after packaging the current source so it does not check an older application. Publishing requires fresh v1.4.5 artifacts, checksum verification and the GitHub Desktop/Actions release workflow.

`publish-v1.4.5.yml` publishes locally built, verified downloads from the temporary `release-upload-v1.4.5` branch. Push the source commit on `main` through GitHub Desktop first, then upload the matching artifacts on that temporary branch. Actions verifies SHA-256 checksums and source correspondence before publishing tag `V1.4.5` at the source commit. The temporary upload branch is removed after publication, and the generated source archives point to the source commit rather than the binary-upload commit.

## Source and licences

Application source is GPL-3.0-or-later. Keep third-party notices with redistributed builds. Stockfish's exact source reference and GPL text are bundled. Foxash 1.4.0 is MIT licensed; its runtime, licence and corresponding source archive are in `resources/foxash`. Foxash repository: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/).

The public source excludes `.private/`, credentials, downloaded SDKs, dependency caches and generated installers. See `.gitignore` before publishing. This workflow builds local artifacts; uploading a release or creating a GitHub repository is separate.

`node scripts/explanation-corpus-smoke.mjs` checks twelve varied positions through actual Stockfish/Foxash, legal alternatives, tactical explanations, EN/IT and immutable results. `node scripts/explanation-smoke.mjs` checks a real-engine tactical cause and alternative benefit, saved explanations/hints, EN/IT, fixed board geometry and phone layout. See [explanation evidence](docs/EXPLANATIONS.md).
