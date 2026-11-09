# Explanation evidence

`core/moveInsight.ts` replays the played move and up to eight plies of its supplied opponent continuation with chess.js. A malformed move or illegal step within that window rejects the line. It returns observable mechanisms rather than inferred human intentions:

- A piece loses its only legal defender when that defender moves, and the line later captures the stationary target.
- Vacating a square clears a rook, bishop or queen line used against a target or directly checked king.
- An opposing knight or pawn legally attacks two non-pawn targets, including a checked king.
- A slider pins a single friendly blocker to its king.
- The legal continuation reaches mate, with a back-rank label only when the king is on its home rank, the mating rook/queen is on that rank and at least two nearby friendly pawns restrict escapes.

Defenders are checked by a hypothetical legal capture onto the defended square; a piece pinned to its king is not counted merely because its geometric attack reaches the target. Alternative-defense claims require replaying the actual suggested move and verifying that the original target remains defended.

The inspector does not run another engine search. It does not prove that a fork wins material, that every move in a principal variation is forced, or that an eight-ply window establishes a long-term strategic plan. Later events are explicitly introduced as occurring in the analysed line. If evidence is absent, the coach uses the legal first reply or a restrained comparison instead of inventing a cause.

`reviewCoaching` uses the mechanisms for moves that concede at least 45 centipawns, are not the best move and are not the only legal move. Sound best moves and forced moves retain their existing treatment. New and refreshed saved reviews use the same copy and specific hints; Foxash policy hints remain the fallback when no specific causal hint is available. Existing saved reviews can show the new coaching from their saved reply PV without changing their scores or annotations. Missing or short PVs limit the available explanation.

English and Italian copies use the identified player's perspective. Phrase selection uses the ply modulo three: it is stable on rerender/navigation and varies across moves without changing the evidence. Common opening, best-move, sound-move, attack, capture and sacrifice descriptions have multiple forms. Terminal/forced-move explanations remain direct.

Training reply playback reuses the inspector only when the supplied attempted move reproduces its actual start position. Reconstructed/restored replies receive localized causes. Tutor context includes the current explanation and a compact evidence summary separately from its system instructions. The tutor is instructed to explain enabling changes and distinguish demonstrated sequences from hypothetical plans.

## Why the alternative helps

`core/alternativeHelp.ts` legally replays the played and suggested moves separately. The blue best-move summary gives the piece, source/destination and one short benefit, such as “Best move: rook a1 → a8. Removes the attacker.” Castling and promotion are named explicitly. The expanded explanation retains the full move description, captured piece, checked reason and continuation. Saved explanations and tutor context retain that reasoning. The same loss/best/forced safeguards apply. It can identify a retained legal defender, a captured first-reply attacker, a blocked attacking line, a target moved beyond immediate legal capture, an avoided fork or absolute pin, an interposition against check, check tempo, a capture without immediate recapture, and exact mate/stalemate outcomes. En-passant capture squares and promotion choices are handled explicitly.

Direct threat comparisons use only the first reply from the played branch. A later PV move is never transplanted into the alternative position. Fork and pin claims replay that first reply legally against the alternative before checking the targets or king line again. Stale evidence from another FEN or played move is ignored. Checking tempo does not imply permanent prevention, and an unrecaptured capture does not establish a lasting material gain. Quiet castling receives no invented king-safety claim. Without a supported mechanism, the coach retains a neutral comparison.

The score, accuracy formula, classification and saved-review data do not change when these explanations are rendered.

## Verification

`tests/move-insight.test.ts` covers immediate and delayed defender loss, preserved cover, pinned defenders/attackers, king-line opening, a legal king/rook fork, an absolute pin, back-rank mate and counterexamples, corrupt continuations, best-move safety, stable phrase variation and Training origin validation.

`tests/alternative-help.test.ts` adds 30 checks. Eleven mechanism fixtures run for both colours with EN/IT text. Counterexamples cover exposed relocations, unchanged forks/pins, quiet castling, stale evidence, illegal alternatives, later-PV branch mixing and immutable review data. The full suite passes 142 tests, with one optional network test skipped. Sacrifice detection and fresh analysis are described in [CLASSIFICATION.md](CLASSIFICATION.md).

`node scripts/explanation-corpus-smoke.mjs` checks twelve positions through actual local Stockfish and Foxash: a quiet opening, an exchange, a weakened king diagonal, allowed/missed immediate mate, defender loss for both colours, a knight fork, castling, en passant, underpromotion and stalemate. It verifies legal alternatives and reply windows, specific known tactical causes, EN/IT in neutral and both player perspectives, best-move safeguards and immutable results. Evidence is written to `verification/explanation-corpus-results.json`.

`node scripts/explanation-smoke.mjs` imports a legal custom-position PGN and reviews it through actual local Stockfish and the Foxash bridge. It checks the identified cause, short blue summary with full reasoning in the initially collapsed disclosure, saved explanation/hint, Italian, phone overflow and fixed board geometry. The existing review UI regression also checks variation navigation and unchanged saved reviews/notes. These bounded checks do not establish general strategic understanding, a chess-strength improvement or physical Android performance.
