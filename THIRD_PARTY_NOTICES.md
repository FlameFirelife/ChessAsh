# Third-party notices

## Stockfish 19 Lite

ChessAsh builds native Stockfish 19 Lite from the Stockfish.js v19.0.1 source and the `nn-61e7af4bb97d.nnue` network. Stockfish and Stockfish.js are distributed under GPL version 3. Provisioning downloads the corresponding source and network, verifies their checksums and builds the native engines. The Windows installer includes the GPL notice in `engines/STOCKFISH-LICENSE.txt`. [Stockfish.js source](https://github.com/nmrugg/stockfish.js/tree/v19.0.1) · [Stockfish upstream](https://github.com/official-stockfish/Stockfish)

See `native/scripts/prepare-engines.ps1` and `native/scripts/build-stockfish.ps1` for the exact build steps.

## Foxash

Foxash 1.4.0 by FlameDev Studios is distributed under the MIT licence. The Windows executable, licence and corresponding source archive are in `resources/foxash`. The Android build uses that archive to compile its Foxash runtime. The `.foxash` review and training rules are ChessAsh source. [Foxash source](https://github.com/FlameFirelife/foxash/)

## Application and assets

- Rust UI by egui and eframe. Dependency versions and source packages are recorded in `native/Cargo.lock`.
- Lucide icons retain their licence in `native/assets/icons/LICENSE`.
- Host Grotesk and Atkinson Hyperlegible Mono are distributed under the SIL Open Font License 1.1. Full notices are in `public/fonts/`.
- Chess-piece and coach SVGs are original ChessAsh artwork. Chess piece sources and hashes are in `public/asset-sources.json`.
- The Windows upgrade helper is packaged with Electron ASAR. It reads the previous library with the Electron runtime from the existing installation.

ChessAsh is independent and is not affiliated with Chess.com or Lichess.
