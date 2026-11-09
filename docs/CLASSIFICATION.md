# Move classifications

Move-quality names can use ChessAsh or Chess.com terminology in Settings. Sound sacrifice becomes Brilliant, Critical find becomes Great, Opening becomes Book and Missed chance becomes Miss. The setting changes names in the review, board effects, move lists, exports and tutor context. It does not copy Chess.com’s scoring algorithm or rewrite saved evaluations.

The quality list, move list, coach and board share `QualityIcon`. Opening/Book uses Lucide’s book icon; other categories use their shared notation. The existing palette and animation timing remain in use.

## Sacrifice evidence

`core/sacrifice.ts` finds legal captures of offered minor pieces, rooks and queens after the played move. It checks legal recapture exchanges and subtracts material taken by the played move; an equal trade is not a sacrifice. A stationary piece must become newly vulnerable, rather than already hanging before an unrelated move. Exchange exploration is bounded; uncertain exchanges are discarded.

Potential sacrifices trigger analysis at depth 14 or higher. A qualifying move must stay within 15 centipawns of the preferred result and leave the mover no worse than -50 centipawns. Exact best-move identity is not required when near-equal candidates exist. Capturing the offer must produce a demonstrated stalemate/draw or a depth-14 restricted engine line supporting compensation. A declined offer can therefore qualify even when the principal variation never captures it. The shared policy and Foxash both give verified sacrifice evidence priority over Critical find. Forced moves, ordinary trades, losing offers and shallow evidence do not receive this label.

The supplied rook-stalemate PGN is checked through actual Stockfish and Foxash. At the tested search settings, 46 of its 49 White moves qualify. This is an engine-checked regression result, not a target count or a claim to match another service’s labels. The original FEN has a high fifty-move counter; legal captures and terminal outcomes are replayed from the supplied position.

## Fresh review and resume

An explicit Reanalyse clears the application’s position cache and starts a new Stockfish worker, including a fresh search table. Completed review rows are not reused. Review policy version 2 prevents old sacrifice facts from being silently reused when a review restarts. Continue review resumes compatible paused results. Applying a coaching pack can still reclassify saved facts without a new search.

`tests/sacrifice.test.ts` covers the supplied drawing mechanism, both colours, declined offers, exchanges, existing hanging pieces, losing/shallow branches and cancellation. `tests/fresh-review.test.ts` distinguishes new searches from paused resume. `scripts/testing-followup-smoke.mjs` additionally clicks Reanalyse twice and observes new UCI search commands, checks saved notes, naming persistence and the shared book icon.

Classification evidence is bounded by engine depth and the analysed branches. Chess.com’s [classification description](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc) also considers player rating and expected points; ChessAsh’s rules are independent.
