# Build ChessAsh

Windows x64 and Android share the Rust app under `native/`. The source version is 1.7.0 and the Android version code is 11. Run the BAT launchers from a Windows checkout with PowerShell 7 and a stable Rust toolchain.

## Windows

Install the MSVC Rust toolchain, Node.js 22 or newer and Inno Setup 6. Install Visual Studio with Desktop development with C++ and the LLVM tools to build Stockfish.

```powershell
npm ci
pwsh -File native/scripts/prepare-engines.ps1 -Platform Windows
.\Build-Windows.bat
```

The Windows launcher builds the Rust executable and writes `release/ChessAsh-Setup-1.7.0.exe`. The small npm dependency packages the V1.5 library transfer helper. Use `-RequireSigned` with a configured certificate. [Signing instructions](SIGNING.md)

## Android

Install JDK 21, Android SDK platform 36 and build tools, NDK 28.2.13676358, and `cargo-ndk`. Install the Rust target for the ABI. Set `ANDROID_HOME` to your SDK location for the engine preparation command.

```powershell
rustup target add aarch64-linux-android
pwsh -File native/scripts/prepare-engines.ps1 -Platform Android -Abi arm64-v8a -Ndk (Join-Path $env:ANDROID_HOME 'ndk/28.2.13676358')
.\Build-Android.bat
```

The Android launcher builds an optimized, signed ARM64 APK for in-place updates. It writes `native/runtime/previews/ChessAsh-1.7.0-android-arm64-v8a.apk`. Use `-Abi x86_64` with the matching engines and Rust target for an emulator. Use `-Debug` for a separate debug install.

Set `JAVA_HOME`, `ANDROID_HOME` or `ANDROID_SDK_ROOT` if the tools are not found. Alternatively use `native/android/local.properties` or the existing local `.private/build-env.json` settings `javaHome`, `androidSdkRoot` and `gradleUserHome`. Keep the Android update key and its Windows-protected password backed up outside the checkout. [Signing instructions](SIGNING.md)

Both launchers pass build failures back as a nonzero exit code. Set `CHESSASH_NO_PAUSE=1` for automation.

[Build guide for the V1.5 source](https://github.com/FlameFirelife/ChessAsh/blob/V1.5/BUILDING.md)
