import type { Game } from './types';

export function playerColorFor(game: Game, mainUsername: string): 'w' | 'b' | undefined {
  if (game.reviewAs === 'neutral') return undefined;
  if (game.reviewAs === 'w' || game.reviewAs === 'b') return game.reviewAs;
  const name = mainUsername.trim().toLowerCase();
  if (!name) return undefined;
  const white = game.headers.White?.trim().toLowerCase() === name;
  const black = game.headers.Black?.trim().toLowerCase() === name;
  return white === black ? undefined : white ? 'w' : 'b';
}
