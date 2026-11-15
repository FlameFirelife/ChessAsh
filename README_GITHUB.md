# ChessAsh V1.6

ChessAsh reviews finished games on Windows and Android. V1.6 rebuilds the app in Rust and runs Stockfish 19 Lite natively. Foxash still handles move classification and training rules.

Download ChessAsh V1.6 for Windows x64 or Android ARM64. Install it over your existing copy of ChessAsh to keep your library, reviews and settings. [Download V1.6](https://github.com/FlameFirelife/ChessAsh/releases/tag/V1.6)

## What it does

- Creates shareable review cards for best moves, mistakes and analysed alternatives, with direct Android sharing.
- Reviews games with move labels, accuracy scores, explanations and playable engine lines.
- Imports Lichess games by username or game link, with separate account collections.
- Offers ChessAsh or Chess.com move-quality names in Settings.
- Explains tactical causes such as a defender leaving, an opened line, a fork or a pin, using legal analysed continuations.
- Shows the best move with arrows and highlights, explaining its concrete benefit when supported by the position, with piece-and-square explanations linked to the board.
- Lets you retry positions and reviews moves you try without changing the saved game.
- Supports English and Italian, with explanations from your side of the game.
- Builds personalized practice from mistakes in your reviewed games, tracks recurring problems and brings positions back for another try.
- Explains failed practice moves with playable replies and gives you a recap of independent solves, retries and positions to revisit.
- Resumes unfinished training sessions, links exercises to the original review position and tracks progress by pattern across sessions.
- Keeps your main account's latest games synced while the app is active, with separate library collections for other imported players.
- Saves games, reviews and notes locally. Saved reviews work offline.
- Offers optional Windows tutoring through local Ollama or a compatible API provider. API charges may apply.

The review screen keeps explanations above the board. Reanalyse starts a fresh engine review; Continue review resumes a paused one. The main header stays visible while scrolling. Mobile review gives more room to the explanation, board and move controls, and the desktop board uses the available width. Piece movement, captures and move feedback animate, with distinct effects for check, stalemate and checkmate and a brief spotlight for sound sacrifices. A reduced-motion setting is available. Enable Move sounds in Settings for a soft wooden tap when navigating or playing moves, including training. Detailed notation, the advantage graph and advanced analysis controls are optional.

Training offers focused practice or short mixed sessions, with exercises for undefended pieces, forks, back-rank mates and other missed opportunities. See the [training guide](TRAINING_GUIDE.md) to get started.

## Foxash in the app

[`rules/review.foxash`](rules/review.foxash) receives chess facts and engine evaluations, then chooses move labels, key moments and retry guidance. Coaching packs can change its thresholds without rerunning Stockfish.

ChessAsh bundles the Foxash runtime on Windows and Android. The source includes its MIT licence and source archive.

[`rules/training.foxash`](rules/training.foxash) chooses training priorities, coaching focus and repeat intervals from your practice history and verified chess facts.

## Build it

See [BUILDING.md](BUILDING.md) for release build commands and [the native README](native/README.md) for engine setup and upgrade details.

## Privacy and limits

Chess.com imports use its public API and need a username, not a password. Public archives can take time to include a new game. Main-account sync checks while the app is visible and online; it does not run after the app closes.

The app's scores and move labels are its own and will differ from Chess.com. Deeper searches can change a result. The bundled Stockfish lite engine uses a smaller network than full Stockfish. Opening recognition currently uses a small authored map.

Training uses completed reviews from your side of the game. Practice history stays on your device and is kept separate from saved games and reviews. It does not require an AI model or API key.

Tutor replies support Markdown, with engine-backed coaching and playable legal continuations. Ollama can run locally. API tutoring sends game context, engine findings and recent chat to the provider you select. There is no silent switch to a cloud model. Model explanations can still be wrong.

V1.6 uses a native Rust interface on both platforms. See [SIGNING.md](SIGNING.md) for release signing and Android update identity.

## Contributing

Bug reports should include the platform, app version and steps to reproduce. A PGN helps with analysis bugs. Keep API keys, private account data and signing material out of reports and commits.

The source includes application code, original SVG pieces, Foxash review rules and tests. Generated builds, local caches and credentials are excluded. Keep `.private/` private, especially the Android update key.

## Licence and credits

ChessAsh by FlameDev is licensed under [GPL-3.0-or-later](LICENSE). Third-party components keep their own licences. See [CREDITS.md](CREDITS.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Foxash by FlameDev Studios: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/).

ChessAsh is independent and is not affiliated with or endorsed by Chess.com.
