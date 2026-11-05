# ChessAsh

Independent post-game chess analysis by FlameDev. Windows and Android builds run without opening a browser or running a server. The current interfaces use Electron and Capacitor. A fully native interface is a later rebuild, not a claim about this version.

## Start using it

Windows: run `release/win-unpacked/ChessAsh.exe` from the complete unpacked folder, or install `release/ChessAsh-Setup-1.0.0.exe`. The binaries are unsigned.

Android: sideload `release/ChessAsh-1.0.0-android.apk`. This is a release build signed with a local app key. It is not a Play Store publication. Use a recent Android System WebView with WebAssembly support.

Choose **Import game**, enter your Chess.com username or open/paste a PGN. Choose **Start review**. Select a turning point, try a move or reveal the line. Saved games and reviews remain on the device.

The Opera game sample is included so you can try the app without an account. It is clearly marked as a sample, not your own game.

## Included

- Public finished-game imports, username memory, PGN collection import, game-link filtering through fetched archives and a searchable local library.
- Local Stockfish 19 lite, saved analysis, pause/resume, review summaries, evaluation graph, both-player move counts and phase summaries.
- Guided explanations with checked continuation lines, move classifications, retries, progressive hints and acceptance of sound alternatives.
- Legal board interaction, animated moves/captures, promotion choice, board flip, keyboard navigation, variation exploration, notes and annotated PGN export.
- Dark/light appearance, text sizing, reduced motion and optional move sounds.
- Windows: bundled Foxash review rules, validated editable coaching packs and optional conversational tutoring through local Ollama or a configured compatible API.

The default view keeps extra controls out of the way. **Settings → Advanced → Show analysis tools** enables extra exploration controls. The Windows **Tutor** tab is always visible and its connection selector offers Off, Ollama or an API provider. Analysis depth and Foxash rule editing are in Advanced. Move quality counts and the complete move list are expandable in the review.

## Foxash has a real job

`rules/review.foxash` receives verified chess/engine facts and decides move labels, review key moments and the first hint. It also returns template IDs and counts. Windows bundles Foxash 1.4.0, its MIT licence and the matching source archive. No separate Foxash installation is required. Android implements the matching default rules in TypeScript.

Windows coaching packs change validated numeric thresholds without executing imported code. Applying a pack reclassifies saved facts without rerunning Stockfish. The original repository at `Desktop/foxash` is untouched.

## Optional tutoring

Open **Tutor** and choose **Ollama on this computer** or **My API provider** from **Tutor connection**. Ollama lists models already installed on this computer. No model is downloaded automatically. API mode accepts a compatible HTTPS endpoint, your own model and your own key; charges are between you and that provider.

The tutor receives the selected position, legal moves, engine findings and recent chat. Alternative lines are checked before preview. Navigating away cancels stale requests. Saved API keys use Windows user-bound encryption and are not returned to the interface. There is no automatic switch from local inference to a cloud provider.

A model can still give an incorrect explanation. No real-model coaching quality claim is made by mocked protocol tests. Basic reviews do not depend on a model or API key.

## Build

Node 22+ is recommended. Dependencies are pinned in `package-lock.json`.

```powershell
npm ci
npm run prepare:engine
node scripts/licenses.mjs
npm run build
npm test
npm run desktop
```

If npm blocks Electron's installation script, run `node node_modules/electron/install.js` explicitly. For development use `npm run dev`; the normal installed application does not need it.

`Build-Windows.bat` produces the Inno Setup installer and adds ChessAsh to the user PATH. Running a newer installer upgrades the existing installation. `Build-Android.bat` produces the signed release APK. See `BUILDING.md` for both workflows. Android additionally needs JDK 21 and Android SDK 36. Set `JAVA_HOME` and `ANDROID_SDK_ROOT`, then use `npm run android:build` for a debug APK or run `npm run build` followed by `npm run android:release` for the signed release. See `PLATFORMS.md` for key backup details and reproducible platform setup.

Keep `.private/` private. It holds the Android update key and an encrypted password. It is deliberately excluded from the public source ZIP. Losing this key prevents installing future builds as updates to this app identity.

## Limits of this build

- Local scoring and labels differ from Chess.com. Higher depth can change them. The lite engine uses a smaller neural network than full Stockfish.
- Opening recognition uses a small authored prefix map. It is not a comprehensive opening database.
- Imported games are standard chess only. Game-link lookup uses the username's requested archives. Public API caching can delay recent games.
- Android pauses analysis when hidden, with completed move results saved for resume. This version does not promise background analysis.
- Consequence grouping is conservative, currently restricted to verifiable forced-mate continuations. General strategic cause tracing is not implemented.
- Personal puzzle sets, spaced repetition, longitudinal statistics and cloud sync are outside this release.
- Windows uses Chromium through Electron and Android uses a WebView through Capacitor. Neither is a fully native widget interface yet.

See `STATUS.md` for the exact build and runtime checks. See `THIRD_PARTY_NOTICES.md` and bundled licence files for engine, artwork, fonts and dependencies.

ChessAsh is not affiliated with or endorsed by Chess.com.

## Foxash source

Foxash by FlameDev Studios: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/). Windows bundles the runtime and corresponding source archive.

## Current visual assets

The board uses original rounded ChessAsh SVG pieces generated by `node scripts/create-pieces.mjs`. No Lichess piece artwork is used by the current source. The charcoal/green interface has separate panel surfaces, animated accuracy rings, a two-sided evaluation graph and visible arrows when a move hint is revealed. Advanced tools remain hidden by default. Current source revisions have not been packaged while the user's packaging pause is active.

## Account collections and the review screen

When importing a username, select **This is my account. Keep it synced.** to make it your main account. ChessAsh checks its latest finished games every two minutes while the app is visible and online, plus eligible focus/reconnect checks. Documented API cache headers and error backoff still apply. It does not fetch while the app is closed. Other imported usernames have separate library collections. Shared games keep one stored copy and can appear in both collections. PGNs and samples have a separate collection.

The current review places explanations in a message above the board with an original super-king SVG. The played square lights up and a quality icon appears. The advantage graph is optional: above zero favours White, below favours Black. Open **Game advantage** to inspect it. Pieces have flat ivory/charcoal fills, thin outlines and no knight facial details. Reduced motion remains available.
