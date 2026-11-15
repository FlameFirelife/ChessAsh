# Foxash review and training policies

ChessAsh bundles Foxash 1.4.0 on Windows and Android. Stockfish and the Rust chess core supply evaluations and verified facts. Foxash uses those facts to choose classifications, key moments, practice priorities and repeat intervals.

The review script reads `facts.json` and writes `review.json` in an isolated temporary directory. It returns move labels, key-moment flags, explanation-template metadata, retry hints and category counts. The Rust coach writes the localized explanations.

The training script reads `training-facts.json` and writes `training-policy.json`. Each result includes a coaching focus, a practice priority and the interval before another attempt. Stockfish grades alternative answers.

Coaching packs contain numeric thresholds. See `default-pack.json` for the standard values and `native/crates/review-engine/src/foxash.rs` for validation and dispatch.

Run the review-engine parity checks with provisioned Windows engines.

```powershell
cargo test --manifest-path native/crates/review-engine/Cargo.toml -- --include-ignored
```

[Foxash source](https://github.com/FlameFirelife/foxash/)
