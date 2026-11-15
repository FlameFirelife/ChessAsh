# ChessAsh V1.6 platforms

Windows and Android share the Rust interface, local SQLite storage, Stockfish 19 Lite, and Foxash policies. Supported CPUs automatically select the AVX2 or Arm dot-product Stockfish build. The portable engine handles older CPUs.

Windows x64 opens maximized and supports the Ollama or API tutor. The Android ARM64 download requires Android 7.0 or later and uses the system document picker and share sheet. Both installers update V1.5 in place and open your existing library. Keep ChessAsh installed while updating.

See [native/README.md](native/README.md) for build, upgrade and testing instructions.

[Platform details for V1.5](https://github.com/FlameFirelife/ChessAsh/blob/V1.5/PLATFORMS.md)
