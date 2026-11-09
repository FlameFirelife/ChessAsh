import type { Game } from './types';
import { accountIdentity } from './accountIdentity';

export function playerColorFor(game: Game, mainUsername: string): 'w' | 'b' | undefined {
  if (game.reviewAs === 'neutral') return undefined;
  if (game.reviewAs === 'w' || game.reviewAs === 'b') return game.reviewAs;
  const identity = accountIdentity(mainUsername);
  const lichess = game.source === 'Lichess' || /^https:\/\/(www\.)?lichess\.org\//i.test(game.url || game.headers.Site || '');
  if ((lichess && identity.provider !== 'lichess') || (game.source === 'Chess.com' && identity.provider !== 'chesscom')) return undefined;
  const name = identity.username;
  if (!name) return undefined;
  const white = game.headers.White?.trim().toLowerCase() === name;
  const black = game.headers.Black?.trim().toLowerCase() === name;
  return white === black ? undefined : white ? 'w' : 'b';
}
