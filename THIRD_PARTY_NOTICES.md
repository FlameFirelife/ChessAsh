# Third-party notices

ChessAsh is an independent companion by FlameDev, not affiliated with Chess.com or Lichess. It uses the documented public Chess.com API for finished games. No Chess.com artwork, sounds, logos or proprietary review scores are included.

## Stockfish.js

Bundled engine: npm `stockfish@19.0.1`, `stockfish-19-lite-single.js` and matching WASM, renamed `stockfish.js` and `stockfish.wasm` without modifying their contents. This is the lite neural-network, single-thread build, not the full network engine.

Copyright the Stockfish contributors and Stockfish.js contributors. GPL version 3. Licence included in `public/engine/COPYING.txt` and the installed engine assets. Exact corresponding source, network/build files and build instructions: https://github.com/nmrugg/stockfish.js/tree/v19.0.1 . Upstream: https://github.com/official-stockfish/Stockfish . Preserve that source reference with any redistribution. SHA256 hashes are in `public/asset-sources.json` for artwork/fonts and the generated release manifest for engine files.

## Foxash

Foxash 1.4.0 by FlameDev Studios, MIT licence. Repository: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/). Windows bundles the existing release executable and source archive from that project; licence is included in `resources/foxash`. The `.foxash` review and training programs are ChessAsh source. Original Foxash source was not modified.

## Chess pieces

The current chess pieces are original rounded SVG artwork created for ChessAsh. Editable source: `scripts/create-pieces.mjs`. They ship under the ChessAsh GPL-3.0-or-later licence. They do not use Lichess or Chess.com piece artwork. The earlier cburnett evaluation set has been removed from the active assets.

## Fonts

Host Grotesk and Atkinson Hyperlegible Mono, under the SIL Open Font License 1.1. Authors, copyright, licences, exact source URLs and hashes are bundled in `public/licenses` and `public/asset-sources.json`. Fonts are self-hosted; the app does not contact a font service.

## Application dependencies

- React and React DOM: Meta Platforms and contributors, MIT. https://github.com/facebook/react
- chess.js: Jeff Hlywa and contributors, BSD-2-Clause. https://github.com/jhlywa/chess.js
- Lucide icons: Lucide contributors, ISC. https://github.com/lucide-icons/lucide
- Capacitor: Ionic and contributors, MIT. https://github.com/ionic-team/capacitor
- Electron: OpenJS Foundation and contributors, MIT; Chromium and other embedded component notices ship with the Electron distribution. https://github.com/electron/electron

Build tools include Vite, TypeScript, electron-builder, Vitest and Playwright. The lockfile pins resolved versions. Dependency licence texts are included in source node_modules after installation; release preparation generates a bundled dependency notices file. ChessAsh application source is distributed under GPL-3.0-or-later to make its redistribution terms clear alongside its chess assets and engine.
