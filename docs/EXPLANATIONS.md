# Explanation evidence

## V1.6 coach

The native coach in `native/crates/review-engine/src/coaching.rs` gives one short reason above the board. It checks the played move and legal replies for concrete changes such as lost defenders, opened lines, and new threats. It can also explain quiet moves through development, central control or preparation for castling. The coach uses the side selected under **Review as** to say “you” or “your opponent”. Linked squares connect the explanation to the board.

The blue best-move summary gives the alternative and its immediate purpose when supported. **Full explanation** adds reasoning when there is more to say. **Show line** plays the actual continuation. `native/crates/review-engine/tests/parity.rs` checks both playing perspectives and representative opening and tactical positions.

[Detailed V1.5 implementation](https://github.com/FlameFirelife/ChessAsh/blob/V1.5/docs/EXPLANATIONS.md)
