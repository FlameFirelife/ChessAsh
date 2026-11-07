import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { findMoveInsights, legalDefenders } from '../src/core/moveInsight';
import { reviewCoaching } from '../src/core/coaching';
import { parsePgn } from '../src/core/pgn';
import type { Game, MoveReview } from '../src/core/types';
import { trainingReplyLine } from '../src/core/trainingSession';

const defenderFen = 'r7/7k/8/8/8/2B5/8/R6K w - - 0 1';
function fixture(fen: string, move: string, pv: string[], best: string): { game: Game; result: MoveReview } {
  const board = new Chess(fen); const played = board.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  return {
    game: { id: 'insight', headers: {}, positions: [fen, board.fen()], moves: [played.san], pgn: board.pgn(), source: 'PGN' },
    result: { ply: 1, color: played.color, move: played.lan, san: played.san, best, replyPv: pv, pv: [], label: 'mistake', loss: 200, before: 200, after: 0, depth: 14, explanation: '', hints: [], key: true },
  };
}

describe('underlying tactical causes', () => {
  it('connects a capture to the defender that left and verifies the alternative preserves cover', () => {
    const insights = findMoveInsights(defenderFen, 'c3d2', ['a8a1'], 'c3b2');
    expect(insights[0].kind).toBe('abandoned-defender');
    expect(insights[0].targets[0].square).toBe('a1');
    expect(insights[0].preservesDefense).toBe(true);
    const { game, result } = fixture(defenderFen, 'c3d2', ['a8a1'], 'c3b2');
    const english = reviewCoaching(game, result, { playerColor: 'w' });
    expect(english.text).toMatch(/defender|defended/);
    expect(english.text).toContain('rook on a1');
    expect(english.detail).toMatch(/keeps.*rook on a1 defended/);
    expect(english.hint).toContain('bishop on c3');
    const italian = reviewCoaching(game, result, { language: 'it', playerColor: 'w' });
    expect(italian.text).toContain('torre in a1');
    expect(italian.detail).not.toMatch(/analysed|defender|piece|engine|line\b/);
  });
  it('tracks a demonstrated consequence beyond the immediate reply without calling it forced', () => {
    const { game, result } = fixture(defenderFen, 'c3d2', ['h7g7', 'h1h2', 'a8a1'], 'c3b2');
    const coach = reviewCoaching(game, result);
    expect(coach.insight?.ply).toBe(3);
    expect(coach.text).toContain('In the analysed line');
    expect(coach.detail).toContain('Kg7 Kh2 Rxa1');
    expect(coach.text).not.toMatch(/forced|guaranteed|inevitable/);
  });
  it('does not count an absolutely pinned piece as a reliable defender', () => {
    expect(legalDefenders('r1r5/7k/8/8/8/2B5/8/R1K5 w - - 0 1', 'a1')).not.toContain('c3');
  });
  it('does not claim abandonment if another defender remains or the same piece still guards along a diagonal', () => {
    expect(findMoveInsights(defenderFen, 'c3d4', ['a8a1']).some(i => i.kind === 'abandoned-defender')).toBe(false);
    const defended = 'r7/7k/8/8/8/2B5/1B6/R6K w - - 0 1';
    expect(findMoveInsights(defended, 'c3d2', ['a8a1']).some(i => i.kind === 'abandoned-defender')).toBe(false);
  });
  it('identifies the pawn move that opens a diagonal toward the king', () => {
    const game = parsePgn('1. e4 f6 *');
    const insights = findMoveInsights(game.positions[1], 'f7f6', ['d1h5']);
    expect(insights[0].kind).toBe('opened-line');
    expect(insights[0].targets[0].square).toBe('e8');
    const result = { ply: 2, color: 'b', move: 'f7f6', best: 'e7e5', label: 'mistake', loss: 150, replyPv: ['d1h5'] } as MoveReview;
    expect(reviewCoaching(game, result, { playerColor: 'b' }).text).toContain('your king on e8');
    expect(reviewCoaching(game, result).detail).toContain('Qh5+');
  });
  it('finds a legal king/rook fork and rejects a pinned attacker’s illegal fork', () => {
    const fen = '7k/8/8/8/1n6/8/7P/R3K3 w - - 0 1';
    const fork = findMoveInsights(fen, 'h2h3', ['b4c2', 'e1d2', 'c2a1']).find(i => i.kind === 'fork');
    expect(fork?.targets.map(p => p.square)).toEqual(['e1', 'a1']);
    expect(findMoveInsights('1k6/8/8/8/1n6/8/7P/RR2K3 w - - 0 1', 'h2h3', ['b4c2'])).toEqual([]);
  });
  it('identifies an absolute pin without saying the pinned piece has no legal moves', () => {
    const { game, result } = fixture('2b4k/8/8/8/8/5N2/P3K3/8 w - - 0 1', 'a2a3', ['c8g4'], 'e2f2');
    const coach = reviewCoaching(game, result);
    expect(coach.insight?.kind).toBe('pin');
    expect(coach.text).toContain('knight on f3');
    expect(coach.detail).toContain('legal moves along the line');
  });
  it('recognizes back-rank mate only with the legal terminal position and pawn shield', () => {
    const insights = findMoveInsights('4r2k/8/8/8/8/8/5PPP/1N4K1 w - - 0 1', 'b1c3', ['e8e1']);
    expect(insights.some(i => i.kind === 'back-rank')).toBe(true);
    const withoutShield = findMoveInsights('4r2k/8/8/8/8/8/8/1N4K1 w - - 0 1', 'b1c3', ['e8e1']);
    expect(withoutShield.some(i => i.kind === 'back-rank')).toBe(false);
  });
  it('rejects corrupt continuations and never labels a best move’s legal recapture as a mistake', () => {
    expect(findMoveInsights(defenderFen, 'c3d2', ['a8a1', 'h1h9'])).toEqual([]);
    expect(findMoveInsights(defenderFen, 'c3d9', ['a8a1'])).toEqual([]);
    const { game, result } = fixture(defenderFen, 'c3d2', ['a8a1'], 'c3d2');
    expect(reviewCoaching(game, { ...result, label: 'sacrifice', loss: 0 }).insight).toBeUndefined();
  });
  it('varies generic wording across moves but keeps the same position stable', () => {
    const game = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *');
    const texts = [1, 2, 3].map(ply => {
      const board = new Chess(game.positions[ply - 1]); const move = board.move(game.moves[ply - 1]);
      const result = { ply, move: move.lan, color: move.color, best: move.lan, label: 'book', loss: 0 } as MoveReview;
      const text = reviewCoaching(game, result).text;
      expect(reviewCoaching(game, result).text).toBe(text);
      return text;
    });
    expect(new Set(texts).size).toBe(3);
  });
  it('shares the cause with training replies only when the attempted position matches', () => {
    const { game } = fixture(defenderFen, 'c3d2', ['a8a1'], 'c3b2');
    const origin = { fen: defenderFen, move: 'c3d2' };
    expect(trainingReplyLine(game.positions[1], ['a8a1'], 'en', 'w', origin)[0].text).toContain('without a defender');
    expect(trainingReplyLine(game.positions[1], ['a8a1'], 'it', 'w', origin)[0].text).toContain('senza difensori');
    expect(trainingReplyLine(game.positions[1], ['a8a1'], 'en', 'w', { ...origin, move: 'c3d4' })[0].text).not.toContain('without a defender');
  });
});
