import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { reviewVariationMove } from '../src/core/variationReview';
import { analyzePosition } from '../src/core/engine';
import type { EngineResult } from '../src/core/types';

vi.mock('../src/core/engine', () => ({ ENGINE_VERSION: 'variation-fixture', analyzePosition: vi.fn() }));

const before = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const evidence = (fen: string): EngineResult => ({ fen, score: fen === before ? 0 : 400, depth: 14, best: fen === before ? 'd7d5' : 'd2d4', pv: [fen === before ? 'd7d5' : 'd2d4'], lines: [] });

beforeEach(() => {
  vi.mocked(analyzePosition).mockReset();
  vi.mocked(analyzePosition).mockImplementation(async fen => evidence(fen));
});

describe('ephemeral move reviews', () => {
  it('uses normal evaluation orientation and classification for a separate one-move game', async () => {
    const { game, result } = await reviewVariationMove(before, 'e7e5', { depth: 14 });
    expect(result).toMatchObject({ color: 'b', move: 'e7e5', loss: 400, label: 'blunder' });
    expect(game.moves).toEqual(['e5']);
    expect(game.positions).toEqual([before, new Chess(before).move('e5').after]);
    expect(game.source).toBe('variation');
    expect(game.review).toBeUndefined();
    expect(game.pgn).toContain('e5');
  });
  it('passes verified facts to the configured review policy', async () => {
    const classify = vi.fn(() => ({ label: 'mistake' as const, key: true }));
    const { result } = await reviewVariationMove(before, 'e7e5', { depth: 14, classify });
    expect(classify).toHaveBeenCalledWith(expect.objectContaining({ loss: 400, verified: true }));
    expect(result.label).toBe('mistake');
  });
  it('rejects illegal moves before running the engine', async () => {
    await expect(reviewVariationMove(before, 'e7e4')).rejects.toThrow();
    await expect(reviewVariationMove(before, 'e7e5junk')).rejects.toThrow();
    expect(analyzePosition).not.toHaveBeenCalled();
  });
  it('does not return partial classifications after cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(analyzePosition).mockImplementation(async fen => {
      controller.abort();
      return evidence(fen);
    });
    await expect(reviewVariationMove(before, 'e7e5', { depth: 14, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
