import { describe, expect, it } from 'vitest';
import { playerColorFor } from '../src/core/perspective';
import { parsePgn } from '../src/core/pgn';

describe('review player identity', () => {
  const game = parsePgn('[White "FlameDev"]\n[Black "Opponent"]\n1. e4 e5 *');
  it('uses the explicitly remembered main account, case insensitively', () => {
    expect(playerColorFor(game, ' flamedev ')).toBe('w');
    expect(playerColorFor(game, 'OPPONENT')).toBe('b');
    expect(playerColorFor(game, '')).toBeUndefined();
    expect(playerColorFor(game, 'guest')).toBeUndefined();
  });
  it('lets PGN users choose a perspective and return to neutral or automatic', () => {
    expect(playerColorFor({ ...game, reviewAs: 'b' }, 'FlameDev')).toBe('b');
    expect(playerColorFor({ ...game, reviewAs: 'neutral' }, 'FlameDev')).toBeUndefined();
    expect(playerColorFor({ ...game, reviewAs: undefined }, 'FlameDev')).toBe('w');
  });
});
