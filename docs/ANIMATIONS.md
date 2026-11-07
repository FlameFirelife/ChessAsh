# Board animations

`Board.tsx` uses stable piece identities from `core/boardMotion.ts`. Position changes animate transforms over 330ms with a small scale lift and settle. When consecutive changes arrive less than 210ms apart, duration adapts to 150–230ms and moved pieces receive two faint, blurred afterimages. The trail layer is capped at twelve images; a new transition replaces the old batch, and completed trails remove themselves. Interrupted movement starts from the computed current transform. Orientation changes snap to the new layout and clear trails. Captures fade and shrink over 230ms after a 60ms delay; the transient captured-piece state clears after 440ms.

`BoardEffects.tsx` and `board-effects.css` provide finite, non-interactive overlays inside the board:

- Landing lights for moved pieces, including both castling pieces.
- Classification rings, with different shapes for strong moves, inaccuracies and mistakes.
- A 1750ms spotlight, rings, sparks and emblem sequence for the existing `sacrifice` classification (Sound sacrifice, `!!`). Other classifications use local board feedback.
- A checked-king highlight and short Check notice; golden outward rings for checkmate; cool inward rings for stalemate.

Position effects use actual legal-board check/checkmate/stalemate state. Their king target follows board orientation. Classification effects use the supplied saved or temporary review result; animations do not change classification rules. Effect keys track the position or review result, so unrelated rerenders and board flips do not restart the sequence. Navigating away removes the old effects immediately. Overlays use pointer-events none and do not alter layout or prevent move input.

App and system reduced-motion settings disable decorative overlays and piece animation. King-state feedback and localized status text remain static. English and Italian are supported.

## Review feedback

`MoveCounter.tsx` animates the existing counter's current value according to navigation direction, with a brief echo in the matching arrow. The move-list highlight uses an absolute overlay aligned to the existing active button. Adjacent selections glide from the currently rendered position; distant jumps fade into place. Resize, disclosure expansion, filtering and scroll position are accounted for without changing row dimensions. The active move exposes `aria-current="step"`.

`useReducedMotion.ts` follows both preference sources and cancels counter/highlight motion when either requests reduced motion. `review-polish.css` adds the coach quality-icon entrance and control feedback. These changes do not alter the grid, spacing, navigation layout or board dimensions.

`useButtonFeedback.ts` delegates pointer, click and Enter/Space feedback to enabled UI buttons, excluding chess squares and inline square references. Icons compress over 75ms and spring back over 260ms; a local surface light fades over 340ms. Navigation arrows use stronger compression than general buttons. Button layout and hit-target size are not scaled. Existing positioned buttons retain their positioning. Native activation is left to the browser: the hook does not prevent events or trigger actions. Drag-away, pointer cancellation, blur, unmount and reduced-motion changes clear feedback; keyboard release tracks the original button when dialog focus moves. There is no additional click audio.

## Audio

`audio/woodTap.ts` synthesizes the muted wooden tap. `audio/moveSound.ts` reuses one AudioContext and buffer, unlocks audio through pointer/keyboard interaction, and limits overlapping playback. Board position changes trigger the sound when Move sounds is enabled; mounting, selecting a piece and flipping the board are silent. Training receives the same preference. Sound works independently of reduced motion.

Use `node scripts/preview-move-sound.mjs` with Node 24 or a compatible TypeScript-stripping runtime to write `verification/wood-tap-preview.wav`.

## Verification

- `node scripts/board-animation-smoke.mjs`: controlled transform interpolation, backward navigation and reduced-motion cancellation.
- `node scripts/board-animation-realtime.mjs`: naturally advancing piece transforms in a visible, inactive Electron window with an isolated profile.
- `node scripts/animation-upgrade-smoke.mjs`: synthetic saved-review fixtures for the sacrifice sequence, other classifications, legal check/end states, orientation, capture, castling, promotion, phone layout, Italian and reduced motion. Screenshots and JSON are written under `verification/`.
- `node scripts/move-sound-smoke.mjs`: real Web Audio buffer-source starts, navigation/capture/manual move, silent mount/flip, sound toggle and reduced-motion independence.
- `node scripts/review-polish-smoke.mjs`: isolated visible Electron checks for adaptive movement, capped trails/cleanup, selection alignment, reversal, orientation, both reduced-motion modes, fixed board bounds and phone layout.
- `node scripts/button-feedback-smoke.mjs`: real mouse/Space/Enter activation, icon compression and cleanup, fixed geometry, drag-away and pointer cancellation, dialog focus changes, chess-square exclusion, reduced motion and phone overflow. Physical touch remains unverified.

The synthetic classification fixture verifies rendering, not engine classification accuracy. Controlled timelines and desktop viewport tests do not establish physical Android smoothness. Audio-source checks do not establish subjective timbre or speaker output.
