# ChessAsh

Free post-game chess analysis for Windows and Android. Import your finished Chess.com games or open a PGN, review the turning points and try a better move.

Stockfish runs on your device. Windows opens maximized. The Android interface respects system-bar and display-cutout spacing. The Windows app also uses [Foxash](https://github.com/FlameFirelife/foxash/) for its review rules and can connect to Ollama or an API tutor you choose.

Get the Windows installer or Android APK from [Releases](https://github.com/FlameFirelife/ChessAsh/releases/latest).

## What it does

- Reviews games with move labels, accuracy scores, explanations and playable engine lines.
- Shows the best move with arrows and highlights, with piece-and-square explanations linked to the board.
- Lets you retry positions and reviews moves you try without changing the saved game.
- Supports English and Italian, with explanations from your side of the game.
- Builds personalized practice from mistakes in your reviewed games, tracks recurring problems and brings positions back for another try.
- Explains failed practice moves with playable replies and gives you a recap of independent solves, retries and positions to revisit.
- Resumes unfinished training sessions, links exercises to the original review position and tracks progress by pattern across sessions.
- Keeps your main account's latest games synced while the app is active, with separate library collections for other imported players.
- Saves games, reviews and notes locally. Saved reviews work offline.
- Offers optional Windows tutoring through local Ollama or a compatible API provider. API charges may apply.

The review screen keeps explanations above the board. The main header stays visible while scrolling, and the desktop board uses the available width. Piece movement, captures and move feedback animate, with distinct effects for check, stalemate and checkmate and a brief spotlight for sound sacrifices. A reduced-motion setting is available. Enable Move sounds in Settings for a soft wooden tap when navigating or playing moves, including training. Detailed notation, the advantage graph and advanced analysis controls are optional.

Training offers focused practice or short mixed sessions, with exercises for undefended pieces, forks, back-rank mates and other missed opportunities. See the [training guide](TRAINING_GUIDE.md) to get started.

## Foxash in the app

[`rules/review.foxash`](rules/review.foxash) receives chess facts and engine evaluations, then chooses move labels, key moments and retry guidance. Coaching packs can change its thresholds without rerunning Stockfish.

The runtime ships with the Windows app, so users do not need to install Foxash separately. Android uses matching default rules in TypeScript. Foxash's MIT licence and source archive are included alongside the bundled runtime.

[`rules/training.foxash`](rules/training.foxash) chooses training priorities, coaching focus and repeat intervals from your practice history and verified chess facts.

## Build it

You need Node.js 22 or newer. Windows installers also need Inno Setup 6. Android builds need JDK 21 and Android SDK 36.

```bat
Build-Windows.bat
Build-Android.bat
```

Build one target at a time. The scripts install locked dependencies, build the current interface and write artifacts to `release/`. The Windows installer adds ChessAsh to PATH and upgrades its previous installation. Android release updates reuse the same signing key.

For development:

```sh
npm ci
npm run prepare:engine
node scripts/licenses.mjs
npm run dev
```

See [BUILDING.md](BUILDING.md) for tool discovery, release metadata, versioning and signing. Run `npm test` for the automated tests. Focused interface and engine checks are in `scripts/`.

## Privacy and limits

Chess.com imports use its public API and need a username, not a password. Public archives can take time to include a new game. Main-account sync checks while the app is visible and online; it does not run after the app closes.

The app's scores and move labels are its own and will differ from Chess.com. Deeper searches can change a result. The bundled Stockfish lite engine uses a smaller network than full Stockfish. Opening recognition currently uses a small authored map.

Training uses completed reviews from your side of the game. Practice history stays on your device and is kept separate from saved games and reviews. It does not require an AI model or API key.

Tutor replies support Markdown, with engine-backed coaching and playable legal continuations. Ollama can run locally. API tutoring sends game context, engine findings and recent chat to the provider you select. There is no silent switch to a cloud model. Model explanations can still be wrong.

Windows uses Electron and Android uses Capacitor. Both render their interface with web technology inside the app. Windows downloads are unsigned; source builds support a configured trusted signing certificate. Android release APKs are signed. See [SIGNING.md](SIGNING.md) for installation warnings and signing setup.

## Contributing

Bug reports should include the platform, app version and steps to reproduce. A PGN helps with analysis bugs. Keep API keys, private account data and signing material out of reports and commits.

The source includes application code, original SVG pieces, Foxash review rules and tests. Generated builds, local caches and credentials are excluded. Keep `.private/` private, especially the Android update key.

## Licence and credits

ChessAsh by FlameDev is licensed under [GPL-3.0-or-later](LICENSE). Third-party components keep their own licences. See [CREDITS.md](CREDITS.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Foxash by FlameDev Studios: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/).

ChessAsh is independent and is not affiliated with or endorsed by Chess.com.
