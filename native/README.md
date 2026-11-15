# ChessAsh V1.6 native builds

The Windows and signed Android releases install over ChessAsh V1.5 and open the existing library automatically. The UI uses the original ChessAsh piece artwork, coach, font families and review layout. Stockfish 19 Lite uses the V1.5 network. Both platforms run the original Foxash review and training rules.

Stockfish uses AVX2 on supported x64 systems and Arm dot-product instructions on supported Android phones. Engine provisioning builds the portable and optimized executables. ChessAsh checks CPU support and falls back to the portable engine when the optimized executable is missing or fails to start. Search depth, thread count, and review checks stay the same.

## Windows

From the ChessAsh folder:

```powershell
npm ci
pwsh -File native/scripts/prepare-engines.ps1 -Platform Windows
.\Build-Windows.bat
```

The installer is written to `release\ChessAsh-Setup-1.6.0.exe`. Run it over the existing V1.5 installation with ChessAsh closed. Setup reads the existing library before replacing the old executable. The updated app opens saved games, reviews, notes, preferences, and training data on first launch.

Run `cargo run --manifest-path native/Cargo.toml --bin chessash-native` for development. The default SQLite profile is `%LOCALAPPDATA%\ChessAsh Native`. Set `CHESSASH_NATIVE_DATA` for an isolated profile. To import a V1.5 library from another profile, export it with `native/migration/Export-Windows.ps1` and open the backup in Settings.

## Android

Use SDK 36, JDK 21, NDK 28.2.13676358 and `cargo-ndk`. Install the Rust target for the chosen ABI. Provide the SDK path in `ANDROID_HOME` or `android/local.properties`.

```powershell
pwsh -File native/scripts/prepare-engines.ps1 -Platform Android -Abi arm64-v8a -Ndk <ndk-directory>
pwsh -File native/scripts/build-android.ps1 -Abi arm64-v8a -Release
```

Use `x86_64` for an x86_64 emulator. The signed APK is written to `native/runtime/previews/` and uses the existing release key in `.private/`. Install it over V1.5 with the installed app still on the device. On first launch, ChessAsh reads its existing Android app storage and opens the saved library. The build without `-Release` creates a development APK.

## Verification

```powershell
cargo test --manifest-path native/Cargo.toml --lib
cargo test --manifest-path native/crates/review-core/Cargo.toml
cargo test --manifest-path native/crates/persistence/Cargo.toml
cargo test --manifest-path native/crates/review-engine/Cargo.toml -- --include-ignored
```

The last command requires the provisioned Windows engines. Windows reanalysis created a new saved review. The API 36 emulator completed a review, explored a temporary move, played the move sound, and opened the native share sheet with a PNG carrying the repository link.

The Windows installer was tested on an isolated copy of the installed V1.5 application, and the signed Android update was tested over V1.5 on an emulator. Remaining checks include exact animation timing, Android accessibility, a live tutor-provider session, and the upgrade on a physical phone.
