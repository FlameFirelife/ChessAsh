import { describe, expect, it } from 'vitest';
import { describeMove, reviewCoaching } from '../src/core/coaching';
import { parsePgn } from '../src/core/pgn';
import type { MoveReview } from '../src/core/types';

describe('explicit board-grounded coaching', () => {
  it('names the actual capturing piece and both squares instead of SAN', () => {
    const game = parsePgn('1. e4 d5 2. exd5 *');
    expect(describeMove(game.positions[2], 'e4d5')).toBe('move the pawn from e4 to d5, taking the pawn on d5');
    expect(describeMove(game.positions[2], 'e4e6')).toBe('');
  });
  it('explains castling, en passant and underpromotion with their real squares', () => {
    const castle = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *');
    expect(describeMove(castle.positions[6], 'e1g1')).toContain('king to g1, rook to f1');
    const ep = parsePgn('1. e4 a6 2. e5 d5 3. exd6 *');
    expect(describeMove(ep.positions[4], 'e5d6')).toContain('taking the pawn on d5 as it passes');
    expect(describeMove('7k/1P6/8/8/8/8/8/K7 w - - 0 1', 'b7b8n')).toContain('promote it to a knight');
  });
  it('shows only legal capture/check replies and works with saved reviews', () => {
    const game = parsePgn('1. e4 d5 2. exd5 Qxd5 *');
    const result = { ply: 3, move: 'e4d5', best: 'e4d5', label: 'best', loss: 0, replyPv: ['d8d5'] } as MoveReview;
    const coach = reviewCoaching(game, result);
    expect(coach.threat).toBe('d8d5');
    expect(coach.text).toContain('queen from d8 to d5, taking the pawn on d5');
    expect(coach.best).toContain('Best move, also played');
    expect(reviewCoaching(game, { ...result, replyPv: ['d8d1'] }).threat).toBeUndefined();
    expect(reviewCoaching(game, { ...result, replyPv: undefined }).threat).toBeUndefined();
  });
  it('changes the explanation with the position instead of repeating the label', () => {
    const game = parsePgn('1. e4 e5 2. Nf3 *');
    const result = { ply: 3, move: 'g1f3', best: 'g1f3', label: 'best', loss: 0 } as MoveReview;
    expect(reviewCoaching(game, result).text).toContain('attacks the pawn on e5');
    expect(reviewCoaching(game, { ...result, ply: 1, move: 'e2e4', best: 'e2e4' }).text).not.toContain('attacks the pawn on e5');
  });
});
