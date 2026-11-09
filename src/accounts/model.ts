import type { Game } from '../core/types';
import { mergeGames } from '../core/pgn';
import { accountIdentity, accountTitle } from '../core/accountIdentity';

export type AccountGame = Game & { accountUsernames?: string[] };
export type AccountGroup = { id: string; username?: string; title: string; kind: 'main' | 'guest' | 'files' | 'earlier'; games: Game[] };
export const normaliseUsername = (name: string) => name.trim().toLowerCase();
export function validUsername(name: string): boolean { return /^[a-z0-9_-]{2,30}$/.test(accountIdentity(name).username); }

export function accountNames(game: Game): string[] {
  const names = (game as AccountGame).accountUsernames;
  return Array.isArray(names) ? [...new Set(names.filter(name => typeof name === 'string' && validUsername(name)).map(normaliseUsername))] : [];
}

export function associateGames(games: Game[], username: string): AccountGame[] {
  const name = normaliseUsername(username);
  if (!validUsername(name)) throw new Error('Enter a valid username.');
  return games.map(game => ({ ...game, accountUsernames: [...new Set([...accountNames(game), name])] }));
}

export function mergeAccountGames(existing: Game[], incoming: Game[]): AccountGame[] {
  const owners = new Map<string, Set<string>>();
  for (const game of [...existing, ...incoming]) {
    const names = owners.get(game.id) || new Set<string>();
    for (const name of accountNames(game)) names.add(name);
    owners.set(game.id, names);
  }
  return mergeGames(existing, incoming).map(game => ({ ...game, accountUsernames: [...(owners.get(game.id) || [])] }));
}

export function migrateLegacyAccount(games: Game[], legacyUsername: string): Game[] {
  const name = normaliseUsername(legacyUsername);
  if (!validUsername(name)) return games;
  let changed = false;
  const migrated = games.map(game => {
    if (game.source !== 'Chess.com' || accountNames(game).length || ![game.headers.White, game.headers.Black].some(player => normaliseUsername(player || '') === name)) return game;
    changed = true;
    return { ...game, accountUsernames: [name] };
  });
  return changed ? migrated : games;
}

export function groupAccountGames(games: Game[], mainUsername = ''): AccountGroup[] {
  const main = normaliseUsername(mainUsername);
  const groups = new Map<string, AccountGroup>();
  if (validUsername(main)) groups.set(main, { id: main, username: main, title: accountTitle(main), kind: 'main', games: [] });
  for (const game of games) {
    const names = accountNames(game);
    if (names.length) {
      for (const name of names) {
        const group = groups.get(name) || { id: name, username: name, title: accountTitle(name), kind: name === main ? 'main' : 'guest', games: [] };
        group.games.push(game);
        groups.set(name, group);
      }
    } else {
      const id = game.source === 'Lichess' ? 'lichess-games' : game.source === 'Chess.com' ? 'earlier-imports' : 'pgn-files';
      const group = groups.get(id) || { id, title: id === 'lichess-games' ? 'Lichess games' : id === 'pgn-files' ? 'PGN files and samples' : 'Earlier imports', kind: id === 'earlier-imports' ? 'earlier' : 'files', games: [] };
      group.games.push(game);
      groups.set(id, group);
    }
  }
  const order = { main: 0, guest: 1, files: 2, earlier: 3 };
  return [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title));
}
