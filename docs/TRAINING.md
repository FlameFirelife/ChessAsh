# Personalized training

Training uses completed reviews from the local library. It selects the main account's side or an explicitly chosen PGN review side. Neutral games, opponents' moves, samples, incomplete reviews and results below depth 8 are excluded. Positions already lost to a forced mate and positions with only one legal move are excluded too.

Cards come from inaccuracies, mistakes, blunders and missed chances with a different legal best move. Duplicate positions are combined. Specific groups cover undefended non-pawn pieces captured by a legal saved reply, knight/pawn forks with multiple legal attack targets and rook/queen back-rank checkmates behind a pawn shield. Pinned captures do not establish a fork. These conservative checks are not a complete tactical-motif detector. Other cards use capture/check/reply or general better-choice groups. Group counts refer to distinct practice positions.

The queue favours repeated groups, previously missed cards and larger evaluation losses. A session contains up to five due cards. The saved best move is accepted directly. Other legal answers receive fresh local depth-12 searches before and after the move; up to 60 centipawns of loss is accepted. Forced-mate handling preserves a winning mate rather than accepting a switch to a non-mating evaluation. Checkmate at distance zero uses the score's side to determine its winner.

Mixed sessions keep the first priority card, then balance pattern and source-game repetition across the remaining due cards. Focused sessions keep the selected pattern. Failed attempts show the actual engine reply in piece-and-square language, with up to four validated continuation moves playable on the board and a return to the attempted position.

On Windows, the bundled `rules/training.foxash` script decides group/focus, priority and repeat intervals from validated facts and practice history. The UI waits for those decisions and uses the focus for its localized coaching prompt. It shows a retry option if the policy fails. Android uses the matching shared defaults in `src/core/trainingPolicy.ts`; no Foxash process runs on Android. Both policies are tested for parity. 

Solved cards return after 1, 3, 7, 14 and then 30 days as consecutive successes increase. Missed or revealed cards return after ten minutes. A failed card can also be retried immediately within the exercise. The interface shows how many positions in each group were solved on their most recent attempt.

Solving after revealing the answer is recorded as assisted and does not increase the independent-success count or streak. It keeps the shorter repeat interval. Session recaps separate first-try independent solves, independent solves after retries and revealed solutions. They list positions to revisit, display the next practice time and offer immediate focused replay.

Practice records use a separate localStorage key per normalized main username. Explicitly selected PGN sides use a separate fallback profile when no main account is configured. Records contain attempts, successful attempts, consecutive successes and due/last-attempt timestamps. Training never writes to the game, review or annotations. Cancelling an engine check prevents its result from being recorded; storage failures are shown to the user.

Unfinished sessions use the same profile key with `:session`. Versioned snapshots store card IDs/focus, the session ID, exercise index, recorded outcomes, attempted move and reply-preview moves/index. Game objects are not duplicated into the snapshot. Restore re-resolves cards against the current eligible library and validates/replays moves. Missing or changed cards invalidate the snapshot. Interrupted checks restart at the exercise; confirmed results are restored without recording another attempt. Completed sessions clear the snapshot. The last main screen is restored to Training when it was last active.

Completed-session events use the profile key with `:events`, capped at 2,000 position results. Session/card IDs prevent duplicate records on repeated completion effects. Pattern charts compare the most recent five position results with the preceding five; a trend requires two full windows drawn from at least two sessions. Independent solves exclude revealed-answer attempts. Older aggregate practice counters are preserved, but prior session events are not invented. `trainingProgress.ts` contains aggregation and `trainingResume.ts` handles snapshot validation.

Open source position returns to the exact played move on Review. The unfinished exercise remains available when returning to Training. Review navigation shortcuts are inactive while Training is displayed.

Both English and Italian are supported. No model, API key or server is used for training. Progress remains on the device. Engine depth and saved-review quality limit the grading, just as they limit the review itself.

Verification: `npm test`, `npm run build` and `node scripts/v13-training-smoke.mjs`. The UI check uses hidden Electron with the real local engine, an isolated profile and a 390px viewport. It does not establish physical Android or installed-upgrade behaviour.

`node scripts/v13-finishing-smoke.mjs` additionally closes and relaunches the actual Electron app with the same isolated profile, checks source-position navigation, restores an answered exercise without duplicate attempts and verifies persistent progress and Italian phone-layout labels.
