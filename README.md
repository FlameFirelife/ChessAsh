# ChessAsh v1.1

Free post-game chess analysis for Windows and Android. Import your finished Chess.com games or open a PGN, review the turning points and compare your moves with better options.

Stockfish runs on your device. The Windows app also uses [Foxash](https://github.com/FlameFirelife/foxash/) for its review rules and can connect to Ollama or an API tutor you choose. Standard reviews need no app account, paid AI service or separate Foxash installation.

## What changed in v1.1

Explanations now name the pieces and squares involved. Instead of asking you to interpret a move such as `exd5`, the coach describes moving the pawn from e4 to d5 and taking the pawn there. Hover, focus or tap a square name to highlight it on the board.

The best move, blue arrow and square highlights appear as soon as you open a reviewed move. The review opens on the position before the move. Select **Played move · after** to animate what happened and inspect the reply. Dashed red arrows mark legal captures or checks from the saved engine line. Highlighted occupied squares show pieces attacked by the moved piece; an attack does not always mean a piece can be won.

The review no longer has a Hint button. **Try again** opens a separate practice mode and hides the best-move answer. Piece movement animates when you switch positions or make a move yourself. Reduced motion remains available.

Saved reviews use the new explanations without another engine run. Analysis speed is unchanged in this update.

## What it does

- Reviews games with move labels, accuracy scores, explanations and playable engine lines.
- Lets you retry positions and accepts sufficiently strong alternatives.
- Keeps your main account's latest games synced while the app is visible and online, with separate collections for other imported players.
- Saves games, reviews and notes locally. Saved reviews work offline.
- Offers optional Windows tutoring through local Ollama or a compatible API provider. API charges may apply.

Explanations sit above the board. Detailed notation, the advantage graph and advanced analysis controls are optional. Choose **Import game** to enter a Chess.com username or open a PGN, then **Start review**. The Opera game sample lets you try a review without importing anything.

## Foxash in the app

[`rules/review.foxash`](rules/review.foxash) receives chess facts and engine evaluations, then chooses move labels, key moments and coaching templates. Coaching packs can change its thresholds without rerunning Stockfish.

The runtime ships with the Windows app. Android uses matching default rules in TypeScript. Foxash's MIT licence and source archive are included alongside the bundled runtime.

## Build it

You need Node.js 22 or newer. Windows installers also need Inno Setup 6. Android builds need JDK 21 and Android SDK 36.

```bat
Build-Windows.bat
Build-Android.bat
```

Build one target at a time. The scripts install locked dependencies, build the current interface and write artifacts to `release/`:

- Windows installer: `ChessAsh-Setup-1.1.0.exe`
- Android release APK: `ChessAsh-1.1.0-android.apk`
- Android debug APK: `ChessAsh-1.1.0-android-debug.apk`, using `Build-Android.bat -Debug`

The Windows installer offers a PATH entry and updates its previous installation. Android release updates need the same signing key. This source is configured for version `1.1.0` and Android version code `3`. Both v1.1 packages were built with the launchers above. The packaged Windows app passed a local review check. The Android APK passed signature and version checks; device testing is still needed.

For development:

```sh
npm ci
npm run prepare:engine
node scripts/licenses.mjs
npm run dev
```

See [BUILDING.md](BUILDING.md) for tool discovery, release metadata, versioning and signing, and [PLATFORMS.md](PLATFORMS.md) for platform details. Run `npm test` for the automated tests. Exact verification results are in [STATUS.md](STATUS.md).

## Privacy and limits

Chess.com imports use its public API and need a username, not a password. Public archives can take time to include a new game. Main-account sync does not run after the app closes.

The app's scores and move labels are its own and will differ from Chess.com. Deeper searches can change a result. The bundled Stockfish lite engine uses a smaller network than full Stockfish. Opening recognition currently uses a small authored map.

Ollama can run locally. API tutoring sends game context, engine findings and recent chat to the provider you select. There is no silent switch to a cloud model. Model explanations can still be wrong.

Windows uses Electron and Android uses Capacitor. Both render their interface with web technology inside the app. Windows builds are unsigned. Earlier Android builds were checked in an emulator; the v1.1 interface has been checked at phone width in Electron, with physical-device testing still needed.

## Contributing

Bug reports should include the platform, app version and steps to reproduce. A PGN helps with analysis bugs. Keep API keys, private account data and signing material out of reports and commits.

The source includes application code, original SVG pieces, Foxash review rules and tests. Keep `.private/` private, especially the Android update key. Losing that key prevents future builds from updating an existing release installation.

## Licence and credits

ChessAsh by FlameDev is licensed under [GPL-3.0-or-later](LICENSE). Third-party components keep their own licences. See [CREDITS.md](CREDITS.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Foxash by FlameDev Studios: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/).

ChessAsh is independent and is not affiliated with or endorsed by Chess.com.
