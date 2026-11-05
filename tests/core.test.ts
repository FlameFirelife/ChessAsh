import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { parsePgn, parsePgnCollection, exportPgn, playUci, variationSan, mergeGames } from '../src/core/pgn';
import { classify, accuracy } from '../src/core/policy';
import { scoreFromUci, parseInfo } from '../src/core/engine';
import { openingName } from '../src/core/openings';
import { factsForMove, continuationEvidence, groupForcedConsequence } from '../src/core/analysis';
import type { MoveReview, ReviewFacts, EngineResult } from '../src/core/types';

describe('chess game import and replay', () => {
  it('replays castling with one position per ply', () => {
    const game = parsePgn('[Event "Castling"]\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *');
    expect(game.positions).toHaveLength(game.moves.length + 1);
    expect(new Chess(game.positions.at(-1)).get('g1')?.type).toBe('k');
    expect(new Chess(game.positions.at(-1)).get('f1')?.type).toBe('r');
    expect(openingName(game.moves)).toBe('Italian Game');
  });
  it('handles en passant', () => {
    const game = parsePgn('1. e4 a6 2. e5 d5 3. exd6 *');
    const board = new Chess(game.positions.at(-1));
    expect(board.get('d5')).toBeUndefined();
    expect(board.get('d6')?.color).toBe('w');
  });
  it('handles underpromotion and preserves the starting FEN on export', () => {
    const game = parsePgn('[SetUp "1"]\n[FEN "7k/1P6/8/8/8/8/8/K7 w - - 0 1"]\n1. b8=N *');
    expect(new Chess(game.positions.at(-1)).get('b8')?.type).toBe('n');
    game.notes = { 1: 'An underpromotion.' };
    const exported = exportPgn(game);
    expect(exported).toContain('An underpromotion.');
    expect(parsePgn(exported).positions).toEqual(game.positions);
  });
  it('recognises terminal mate and stalemate', () => {
    const mate = parsePgn('1. f3 e5 2. g4 Qh4# 0-1');
    expect(new Chess(mate.positions.at(-1)).isCheckmate()).toBe(true);
    const stalemate = parsePgn('[SetUp "1"]\n[FEN "7k/4Q3/6K1/8/8/8/8/8 w - - 0 1"]\n1. Qf7 1/2-1/2');
    expect(new Chess(stalemate.positions.at(-1)).isStalemate()).toBe(true);
  });
  it('rejects malformed, empty and unsupported-variant games', () => {
    expect(() => parsePgn('')).toThrow();
    expect(() => parsePgn('1. e4 e5 2. Qa8')).toThrow();
    expect(() => parsePgn('[Variant "Chess960"]\n1. e4')).toThrow('not supported');
  });
  it('splits collections, deduplicates and preserves reviewed data', () => {
    const text = '[Event "A"]\n1. e4 e5 *\n\n[Event "B"]\n1. d4 d5 *';
    const games = parsePgnCollection(text);
    expect(games).toHaveLength(2);
    games[0].notes = { 1: 'Keep this' };
    expect(mergeGames(games, parsePgnCollection(text))).toHaveLength(2);
    expect(mergeGames(games, parsePgnCollection(text)).find(game => game.id === games[0].id)?.notes?.[1]).toBe('Keep this');
  });
  it('rejects illegal UCI and truncates illegal continuation lines', () => {
    const fen = new Chess().fen();
    expect(playUci(fen, 'e2e5')).toBeNull();
    expect(playUci(fen, 'e2e4')?.san).toBe('e4');
    expect(variationSan(fen, ['e2e4', 'e7e5', 'a1a8'])).toEqual(['e4', 'e5']);
  });
});

describe('review scoring and policy', () => {
  const base: ReviewFacts = { loss: 0, playedBest: false, book: false, missedChance: false, critical: false, sacrifice: false, verified: false };
  it('uses explicit cp thresholds and conservatively verifies exceptional labels', () => {
    expect(classify({ ...base, loss: 0, playedBest: true })).toBe('best');
    expect(classify({ ...base, loss: 44 })).toBe('good');
    expect(classify({ ...base, loss: 45 })).toBe('inaccuracy');
    expect(classify({ ...base, loss: 100 })).toBe('mistake');
    expect(classify({ ...base, loss: 150, missedChance: true })).toBe('miss');
    expect(classify({ ...base, loss: 250 })).toBe('blunder');
    expect(classify({ ...base, playedBest: true, sacrifice: true })).toBe('best');
    expect(classify({ ...base, playedBest: true, sacrifice: true, verified: true })).toBe('sacrifice');
  });
  it('measures our documented score and filters by player', () => {
    const results = [{ color: 'w', loss: 0 }, { color: 'b', loss: 300 }] as MoveReview[];
    expect(accuracy(results, 'w')).toBe(100);
    expect(accuracy(results, 'b')).toBe(37);
    expect(accuracy([], 'w')).toBe(0);
  });
  it('normalises black and white engine scores including forced mate', () => {
    expect(scoreFromUci(75, 'cp', 'w').score).toBe(75);
    expect(scoreFromUci(75, 'cp', 'b').score).toBe(-75);
    expect(scoreFromUci(-3, 'mate', 'b')).toEqual({ score: 29700, mate: 3 });
    expect(parseInfo('info depth 14 multipv 2 score cp -55 pv e7e5 g1f3', 'b')).toEqual({ rank: 2, depth: 14, score: 55, pv: ['e7e5', 'g1f3'] });
    expect(parseInfo('info depth 14 score cp 5 lowerbound pv e2e4', 'w')).toBeNull();
  });
  it('does not penalise a sole legal move for a deeper-search score difference', () => {
    const game = parsePgn('[SetUp "1"]\n[FEN "8/8/8/8/8/5k1q/8/7K w - - 0 1"]\n1. Kg1 Qg2# 0-1');
    const evidence = (score: number): EngineResult => ({ fen: '', score, depth: 14, best: 'h1g1', pv: ['h1g1'], lines: [] });
    const facts = factsForMove(game, 1, evidence(-1000), evidence(-29900));
    expect(facts.playedBest).toBe(true);
    expect(facts.loss).toBe(0);
    expect(classify(facts)).toBe('best');
  });
  it('does not call a preserved forced mate a blunder solely for mate distance', () => {
    const game = parsePgn('1. e4 e5 *');
    const evidence = (score: number, mate?: number): EngineResult => ({ fen: '', score, mate, depth: 14, best: 'd2d4', pv: ['d2d4'], lines: [] });
    const preserved = factsForMove(game, 1, evidence(29900, 1), evidence(29400, 6));
    expect(preserved.loss).toBe(0);
    expect(classify({ ...preserved, book: false })).toBe('excellent');
    const lost = factsForMove(game, 1, evidence(29900, 1), evidence(0));
    expect(lost.loss).toBe(29900);
    expect(classify({ ...lost, book: false })).toBe('blunder');
  });
  it('describes only legal captures and demonstrable checkmate continuations', () => {
    const capture = new Chess('4k3/8/8/8/4N3/8/8/4r1K1 b - - 0 1');
    expect(continuationEvidence(capture.fen(), 'w', ['e1e4'])).toContain('captures your knight on e4');
    const mate = '8/8/8/8/8/5k1q/8/6K1 b - - 1 1';
    expect(continuationEvidence(mate, 'w', ['h3g2'])).toContain('ends in checkmate');
    expect(continuationEvidence(mate, 'w', ['a8a1'])).toBe('');
  });
  it('groups a forced reply only while the earlier forced-mate loss persists', () => {
    const game = parsePgn('[SetUp "1"]\n[FEN "8/8/8/8/6q1/5k2/8/R5K1 w - - 0 1"]\n1. Kh1 Qh3+ 2. Kg1 Qg2# 0-1');
    const cause = { ply: 1, color: 'w', before: 0, after: -29700, key: true, san: 'Kh1' } as MoveReview;
    const reply = { ply: 2, color: 'b', after: -29800 } as MoveReview;
    const forced = { ply: 3, color: 'w', before: -29800, after: -29900, key: false, explanation: 'Best.' } as MoveReview;
    expect(groupForcedConsequence(game, forced, [cause, reply]).consequenceOf).toBe(1);
    expect(groupForcedConsequence(game, forced, [cause, { ...reply, after: 0 }]).consequenceOf).toBeUndefined();
  });
});
