import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
const mocks = vi.hoisted(() => ({ analyze: vi.fn(), reset: vi.fn() }));
vi.mock('../src/core/engine', () => ({ analyzePosition: mocks.analyze, resetEngineAnalysis: mocks.reset, ENGINE_VERSION: 'test engine' }));
import { analyzeGame } from '../src/core/analysis';
import { parsePgn } from '../src/core/pgn';
import { POLICY_VERSION } from '../src/core/policy';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.analyze.mockImplementation(async (fen: string, options) => {
    const board = new Chess(fen), best = board.moves({ verbose: true })[0]?.lan || '';
    return { fen, depth: options.depth, score: 0, best, pv: best ? [best] : [], lines: [] };
  });
});
describe('fresh engine reviews', () => {
  it('discards completed results and resets engine searches only for explicit fresh analysis', async () => {
    const game = parsePgn('1. e4 e5 *'); game.notes = { 1: 'Keep this annotation' };
    game.review = await analyzeGame(game, { depth: 4 });
    const saved = JSON.stringify(game), firstCalls = mocks.analyze.mock.calls.length;
    await analyzeGame(game, { depth: 4 });
    expect(mocks.analyze).toHaveBeenCalledTimes(firstCalls);
    const progress = vi.fn();
    const rerun = await analyzeGame(game, { depth: 4, fresh: true, onProgress: progress });
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    expect(mocks.analyze.mock.calls.length).toBeGreaterThan(firstCalls);
    expect(progress.mock.calls[0]).toEqual([0, 2]);
    expect(rerun.version).toBe(POLICY_VERSION);
    expect(JSON.stringify(game)).toBe(saved);
  });
  it('keeps finished plies when resuming a paused compatible review', async () => {
    const game = parsePgn('1. e4 e5 *');
    const review = await analyzeGame(game, { depth: 4 });
    game.review = { ...review, results: review.results.slice(0, 1), completed: false };
    mocks.analyze.mockClear();
    const resumed = await analyzeGame(game, { depth: 4 });
    expect(resumed.results[0].move).toBe(review.results[0].move);
    expect(resumed.completed).toBe(true);
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.analyze.mock.calls[0][0]).toBe(game.positions[1]);
  });
});
