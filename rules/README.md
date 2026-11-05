# Foxash review policy

Windows bundles Foxash 1.4.0 and executes `review.foxash` against engine-verified facts. Users do not install Foxash separately. The original language repository is not changed.

The script owns classification, key-moment selection, explanation-template selection, progressive-hint selection and per-category counts. Stockfish and the chess core supply evaluations and verified facts; the script does not search chess positions or decide legality.

Input in an isolated temporary working directory is `facts.json`, with `count`, `moves` and `rules`. Output is `review.json`, an array containing result rows and category counts. Result rows are `[label, key, template, hint]`. Counts follow this order: book, best, excellent, good, inaccuracy, mistake, blunder, miss, great, sacrifice.

Custom coaching packs contain validated numeric centipawn thresholds. They do not contain executable code. `default-pack.json` preserves the standard policy. Thresholds must increase from excellent through inaccuracy, mistake and blunder. A custom pack changes the review policy without rerunning Stockfish. Default policy parity with Android is tested against the shared reference facts.

Only the bundled script is executed. Editing that installed script manually is trusted local development and is not an advertised import mechanism. Foxash currently supports file I/O; executing arbitrary downloaded scripts would therefore grant more access than a coaching pack needs.

To demonstrate Foxash's role, run `npm test -- tests/policy.test.ts`: the suite executes the actual bundled runtime, checks default-policy parity, then changes a pack so the same 150-centipawn loss changes from mistake to blunder.

## Foxash source

Foxash by FlameDev Studios: [github.com/FlameFirelife/foxash](https://github.com/FlameFirelife/foxash/). Windows bundles the runtime and corresponding source archive.
