# Foxash review and training policies

Windows bundles Foxash 1.4.0 and executes `review.foxash` against engine-verified facts. Users do not install Foxash separately. The original language repository is not changed.

The review script chooses classifications, key moments and per-category counts, and returns template/hint metadata for review and retry guidance. Stockfish and the chess core supply evaluations and verified facts; the script does not search chess positions or decide legality.

`training.foxash` also owns personalized-training focus, queue priorities and repeat intervals on Windows. The chess core verifies candidate moves and replies before supplying capture/check/threat facts. Foxash groups those facts, counts recurring groups, ranks positions using previous practice results and returns the next interval after an attempt. The interface uses the returned focus for its practice group and localized coaching prompt. Stockfish continues to grade alternative answers.

Training uses the isolated `training-facts.json` → `training-policy.json` protocol through `electron/training-policy.cjs`. Each result row contains `[focus, priority, intervalSeconds]`. Inputs and outputs are validated. Windows policy failures are shown with a retry option; the app does not silently change to shared defaults. Android uses matching TypeScript rules in `src/core/trainingPolicy.ts`.

Validated motif evidence also covers undefended non-pawn pieces captured by a reply, legal knight/pawn forks and rook/queen back-rank checkmates behind a pawn shield. The policy prioritizes these specific focus groups before the broad reply/capture/check groups. Android follows the same precedence. Mixed-session selection balances those focus groups and source games after the highest-priority first card. Revealed answers remain assisted when retried, so the scheduling policy receives a failed independent attempt rather than a false mastery signal.

The review script's explanation-template value is metadata; current localized review prose is rendered by the chess core. Training focus is actively consumed by the training interface. Numeric coaching packs still configure review classification thresholds only; they do not configure training policy or import executable scripts.

`tests/training-policy.test.ts` runs the real bundled runtime across focus combinations and interval boundaries, compares Android parity and changes a copied `.foxash` script to demonstrate different priorities, focus and scheduling. `tests/training-bridge.test.ts` checks platform dispatch and error propagation. `scripts/v13-training-smoke.mjs` checks the Windows IPC bridge and a real-engine practice session.

Input in an isolated temporary working directory is `facts.json`, with `count`, `moves` and `rules`. Output is `review.json`, an array containing result rows and category counts. Result rows are `[label, key, template, hint]`. Counts follow this order: book, best, excellent, good, inaccuracy, mistake, blunder, miss, great, sacrifice.

Custom coaching packs contain validated numeric centipawn thresholds. They do not contain executable code. `default-pack.json` preserves the standard policy. Thresholds must increase from excellent through inaccuracy, mistake and blunder. A custom pack changes the review policy without rerunning Stockfish. Default policy parity with Android is tested against the shared reference facts.

Only the bundled script is executed. Editing that installed script manually is trusted local development and is not an advertised import mechanism. Foxash currently supports file I/O; executing arbitrary downloaded scripts would therefore grant more access than a coaching pack needs.

To demonstrate Foxash's role, run `npm test -- tests/policy.test.ts`: the suite executes the actual bundled runtime, checks default-policy parity, then changes a pack so the same 150-centipawn loss changes from mistake to blunder.

## Foxash source

Foxash by FlameDev Studios: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/). Windows bundles the runtime and corresponding source archive.
