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
  it('explains castling, en passant and underpromotion in English and Italian', () => {
    const castle = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *');
    expect(describeMove(castle.positions[6], 'e1g1')).toContain('king to g1, rook to f1');
    expect(describeMove(castle.positions[6], 'e1g1', { language: 'it' })).toContain('re in g1, torre in f1');
    const ep = parsePgn('1. e4 a6 2. e5 d5 3. exd6 *');
    expect(describeMove(ep.positions[4], 'e5d6')).toContain('taking the pawn on d5 as it passes');
    expect(describeMove(ep.positions[4], 'e5d6', { language: 'it' })).toContain('prendendo il pedone in d5 con la presa en passant');
    expect(describeMove('7k/1P6/8/8/8/8/8/K7 w - - 0 1', 'b7b8n')).toContain('promote it to a knight');
    expect(describeMove('7k/1P6/8/8/8/8/8/K7 w - - 0 1', 'b7b8n', { language: 'it' })).toContain('promuovere a cavallo');
  });
  const game = parsePgn('1. e4 d5 2. exd5 Qxd5 *');
  const result = { ply: 3, color: 'w', move: 'e4d5', best: 'e4d5', label: 'best', loss: 0, replyPv: ['d8d5'] } as MoveReview;
  it('does not describe a sound capture as a mistake merely because a recapture is possible', () => {
    const coach = reviewCoaching(game, result);
    expect(coach.threat).toBe('d8d5');
    expect(coach.text).not.toMatch(/allows|left|mistake|capture/);
    expect(coach.detail).toContain('queen from d8 to d5, taking the pawn on d5');
    expect(coach.best).toContain('Best move, also played');
    expect(reviewCoaching(game, { ...result, replyPv: ['d8d1'] }).threat).toBeUndefined();
    expect(reviewCoaching(game, { ...result, replyPv: undefined }).threat).toBeUndefined();
  });
  it('changes the explanation with the position instead of repeating the label', () => {
    const game = parsePgn('1. e4 e5 2. Nf3 *');
    const result = { ply: 3, color: 'w', move: 'g1f3', best: 'g1f3', label: 'best', loss: 0 } as MoveReview;
    expect(reviewCoaching(game, result).text).toContain('pawn on e5');
    expect(reviewCoaching(game, { ...result, ply: 1, move: 'e2e4', best: 'e2e4' }).text).not.toContain('pawn on e5');
    const poorMove = reviewCoaching(game, { ...result, best: 'f1c4', label: 'blunder', loss: 300, replyPv: ['b8c6'] });
    expect(poorMove.text).not.toContain('attacks');
    expect(poorMove.text).toContain('stronger move');
  });
  it('uses the identified player for both the mover and the opponent’s reply', () => {
    const mistake = { ...result, best: 'g1f3', label: 'mistake', loss: 120 } as MoveReview;
    const white = reviewCoaching(game, mistake, { playerColor: 'w' });
    const black = reviewCoaching(game, mistake, { playerColor: 'b' });
    const neutral = reviewCoaching(game, mistake);
    expect(white.text).toBe('Your opponent can capture your pawn on d5.');
    expect(white.detail).toContain('You moved your pawn from e4 to d5');
    expect(black.text).toBe('You can capture your opponent’s pawn on d5.');
    expect(black.detail).toContain('Your opponent moved the pawn from e4 to d5');
    expect(neutral.text).toBe('Black can capture White’s pawn on d5.');
  });
  it('renders Italian perspective and full explanations without English fragments', () => {
    const mistake = { ...result, best: 'g1f3', label: 'mistake', loss: 120 } as MoveReview;
    const white = reviewCoaching(game, mistake, { language: 'it', playerColor: 'w' });
    const black = reviewCoaching(game, mistake, { language: 'it', playerColor: 'b' });
    expect(white.text).toBe('Il tuo avversario può prendere il tuo pedone in d5.');
    expect(black.text).toBe('Puoi prendere il pedone del tuo avversario in d5.');
    expect(white.detail).toContain('Hai spostato il tuo pedone da e4 a d5');
    expect(white.best).toContain('Mossa migliore: spostare il tuo cavallo da g1 a f3');
    expect(white.detail).not.toMatch(/Your|White|Black|move|engine/);
  });
  it('keeps Black’s perspective correct for a missed immediate checkmate', () => {
    const game = parsePgn('1. f3 e5 2. g4 Nc6 *');
    const result = { ply: 4, color: 'b', move: 'b8c6', best: 'd8h4', label: 'miss', loss: 10000 } as MoveReview;
    expect(reviewCoaching(game, result, { playerColor: 'b' }).text).toBe('You missed an immediate checkmate.');
    expect(reviewCoaching(game, result, { playerColor: 'w' }).text).toBe('Your opponent missed an immediate checkmate.');
    expect(reviewCoaching(game, result, { language: 'it', playerColor: 'b' }).text).toBe('Hai mancato uno scacco matto immediato.');
  });
  it('does not call an only legal move a new avoidable mistake', () => {
    const game = parsePgn('[SetUp "1"]\n[FEN "8/8/8/8/8/5k1q/8/7K w - - 0 1"]\n1. Kg1 Qg2# 0-1');
    const result = { ply: 1, color: 'w', move: 'h1g1', best: '', label: 'mistake', loss: 10000, replyPv: ['h3g2'] } as MoveReview;
    expect(reviewCoaching(game, result).text).toBe('This was the only legal move.');
    expect(reviewCoaching(game, result, { language: 'it' }).text).toBe('Questa era l’unica mossa legale.');
    expect(reviewCoaching(game, result).best).toBe('The best move is not available yet.');
  });
});
