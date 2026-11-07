import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { alternativeHelp } from '../src/core/alternativeHelp';
import { findMoveInsights } from '../src/core/moveInsight';
import { explainAlternativeHelp, reviewCoaching } from '../src/core/coaching';
import { parsePgn } from '../src/core/pgn';
import type { MoveReview } from '../src/core/types';

const defender = 'r7/7k/8/8/8/2B5/8/R6K w - - 0 1';
const fork = '7k/8/8/8/1n6/8/7P/R3K3 w - - 0 1';
const pin = '2b4k/8/8/8/8/5N2/P3K3/8 w - - 0 1';
const square = (s: string) => s[0] + (9 - Number(s[1]));
const uci = (s: string) => square(s.slice(0, 2)) + square(s.slice(2, 4)) + s.slice(4);
function mirror(fen: string) {
  const original = new Chess(fen), board = new Chess(); board.clear();
  for (const p of original.board().flat()) if (p) board.put({ color: p.color === 'w' ? 'b' : 'w', type: p.type }, square(p.square) as Square);
  const fields = fen.split(' '), mirrored = board.fen().split(' ');
  mirrored[1] = fields[1] === 'w' ? 'b' : 'w';
  const flags = fields[2].split('').map(s => s === s.toUpperCase() ? s.toLowerCase() : s.toUpperCase());
  mirrored[2] = [...'KQkq'].filter(s => flags.includes(s)).join('') || '-';
  mirrored[3] = fields[3] === '-' ? '-' : square(fields[3]);
  return mirrored.join(' ');
}

const cases = [
  { name: 'keeps the defender in place', fen: defender, played: 'c3d2', pv: ['a8a1'], best: 'c3b2', kind: 'preserves-defense' },
  { name: 'captures the attacking rook', fen: defender, played: 'c3d2', pv: ['a8a1'], best: 'a1a8', kind: 'removes-attacker' },
  { name: 'moves the target off its capture square', fen: defender, played: 'c3d2', pv: ['a8a1'], best: 'a1b1', kind: 'escapes-capture' },
  { name: 'keeps a king diagonal blocked', fen: parsePgn('1. e4 *').positions[1], played: 'f7f6', pv: ['d1h5'], best: 'e7e5', kind: 'keeps-line-closed' },
  { name: 'steps out of a king-rook fork', fen: fork, played: 'h2h3', pv: ['b4c2', 'e1d2', 'c2a1'], best: 'e1d1', kind: 'avoids-fork' },
  { name: 'moves the king away from a pin', fen: pin, played: 'a2a3', pv: ['c8g4'], best: 'e2f2', kind: 'avoids-pin' },
  { name: 'interposes against check', fen: 'k5r1/8/8/8/8/8/4B3/6K1 w - - 0 1', played: 'g1h1', pv: [], best: 'e2g4', kind: 'answers-check' },
  { name: 'uses check for tempo without claiming permanent prevention', fen: fork, played: 'h2h3', pv: ['b4c2'], best: 'a1a8', kind: 'gives-check' },
  { name: 'handles the actual en-passant capture square', fen: '7k/8/8/3pP3/8/8/8/K7 w - d6 0 1', played: 'a1b1', pv: [], best: 'e5d6', kind: 'unrecaptured-capture' },
  { name: 'recognizes a checking underpromotion', fen: '8/k1P5/2K5/8/8/8/8/8 w - - 0 1', played: 'c6d6', pv: [], best: 'c7c8n', kind: 'gives-check' },
  { name: 'distinguishes stalemate from winning material', fen: 'k7/8/1QK5/8/8/8/8/8 w - - 0 1', played: 'b6b5', pv: [], best: 'b6c7', kind: 'stalemate' },
];

describe('checked reasons for the alternative', () => {
  for (const entry of cases) for (const black of [false, true]) it(`${entry.name}, ${black ? 'Black' : 'White'} perspective`, () => {
    const fen = black ? mirror(entry.fen) : entry.fen, played = black ? uci(entry.played) : entry.played, best = black ? uci(entry.best) : entry.best;
    const pv = black ? entry.pv.map(uci) : entry.pv;
    const board = new Chess(fen), original = board.fen();
    const insight = findMoveInsights(fen, played, pv, best)[0];
    const help = alternativeHelp(fen, played, best, insight);
    expect(help?.kind).toBe(entry.kind);
    expect(board.fen()).toBe(original);
    for (const language of ['en', 'it'] as const) {
      const text = explainAlternativeHelp(help!, { language, playerColor: board.turn() });
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/undefined|NaN|guarantee|inevitable|guaranteed win/);
      if (language === 'it') expect(text).not.toMatch(/The alternative|The move|checking line|defended|recapture/);
    }
  });
  it('does not call an exposed relocation a safe escape', () => {
    const insight = findMoveInsights(defender, 'c3d2', ['a8a1'])[0];
    expect(alternativeHelp(defender, 'c3d2', 'a1a2', insight)).toBeUndefined();
  });
  it('does not say a fork or pin is prevented when both targets/line remain', () => {
    expect(alternativeHelp(fork, 'h2h3', 'h2h4', findMoveInsights(fork, 'h2h3', ['b4c2'])[0])).toBeUndefined();
    expect(alternativeHelp(pin, 'a2a3', 'a2a4', findMoveInsights(pin, 'a2a3', ['c8g4'])[0])).toBeUndefined();
  });
  it('does not replay a later opponent move directly against a different branch', () => {
    const insight = findMoveInsights(defender, 'c3d2', ['h7g7', 'h1h2', 'a8a1'])[0];
    expect(insight.ply).toBe(3);
    expect(alternativeHelp(defender, 'c3d2', 'a1a8', insight)?.kind).not.toBe('removes-attacker');
  });
  it('rejects illegal, identical and malformed alternatives', () => {
    expect(alternativeHelp(defender, 'c3d2', 'a1h8')).toBeUndefined();
    expect(alternativeHelp(defender, 'c3d2', 'c3d2')).toBeUndefined();
    expect(alternativeHelp('invalid fen', 'a1a2', 'a1b1')).toBeUndefined();
  });
  it('does not borrow a threat from a different position or played move', () => {
    const stale = findMoveInsights(defender, 'c3d2', ['a8a1'])[0];
    expect(alternativeHelp(defender, 'c3d4', 'a1a8', stale)?.kind).not.toBe('removes-attacker');
    const movedKing = new Chess(defender); movedKing.move('Kh2');
    expect(alternativeHelp(movedKing.fen(), 'h7g7', 'a8a7', stale)?.kind).not.toBe('removes-attacker');
  });
  it('does not invent a safety benefit for quiet castling', () => {
    expect(alternativeHelp('k7/8/8/8/8/8/P7/4K2R w K - 0 1', 'a2a3', 'e1g1')).toBeUndefined();
  });
  it('recognizes a concrete missed mate without assuming which colour the player is', () => {
    const game = parsePgn('1. f3 e5 2. g4 Nc6 *');
    const result = { ply: 4, color: 'b', move: 'b8c6', best: 'd8h4', label: 'miss', loss: 10000 } as MoveReview;
    const coach = reviewCoaching(game, result, { playerColor: 'b' });
    expect(coach.alternativeHelp?.kind).toBe('mate');
    expect(coach.best).toBe('Best move: queen d8 → h4. Checkmate.');
    expect(coach.detail).toContain('immediately with checkmate');
  });
  it('separates the short benefit from full reasoning without changing saved results', () => {
    const game = parsePgn('[SetUp "1"]\n[FEN "'+defender+'"]\n1. Bd2 *');
    const result = { ply: 1, color: 'w', move: 'c3d2', best: 'a1a8', replyPv: ['a8a1'], label: 'mistake', loss: 200 } as MoveReview;
    const snapshot = JSON.stringify({ game, result });
    const coach = reviewCoaching(game, result, { playerColor: 'w' });
    expect(coach.best).toBe('Best move: rook a1 → a8. Removes the attacker.');
    expect(coach.detail).toContain('removes your opponent’s rook on a8');
    expect(coach.detail).toContain('Best move: move your rook from a1 to a8, taking the rook on a8.');
    expect(JSON.stringify({ game, result })).toBe(snapshot);
    expect(reviewCoaching(game, { ...result, best: result.move, loss: 0, label: 'sacrifice' }).alternativeHelp).toBeUndefined();
  });
});
