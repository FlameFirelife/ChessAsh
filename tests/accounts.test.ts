import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePgn } from '../src/core/pgn';
import { importChessCom } from '../src/core/importer';
import type { Game } from '../src/core/types';
import { accountNames, associateGames, groupAccountGames, mergeAccountGames, migrateLegacyAccount } from '../src/accounts/model';
import { AccountSyncCoordinator, SYNC_INTERVAL } from '../src/accounts/sync';

const game = (white = 'ash', black = 'rival') => parsePgn(`[Event "Account fixture"]\n[White "${white}"]\n[Black "${black}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`, 'Chess.com');
afterEach(() => vi.restoreAllMocks());

describe('account collections', () => {
  it('keeps imported usernames separate without inventing opponent accounts', () => {
    const own = associateGames([game()], 'Ash');
    const guest = associateGames([game('visitor', 'other')], 'Visitor');
    const manual = parsePgn('1. d4 d5 *', 'PGN');
    const groups = groupAccountGames([...own, ...guest, manual], 'ash');
    expect(groups.map(group => [group.id, group.kind])).toEqual([['ash', 'main'], ['visitor', 'guest'], ['pgn-files', 'files']]);
    expect(groups.some(group => group.id === 'rival' || group.id === 'other')).toBe(false);
    expect(groups[0].games[0].id).toBe(own[0].id);
  });
  it('keeps an overlapping game in both account containers while preserving its review and notes', () => {
    const original = { ...associateGames([game()], 'ash')[0], notes: { 1: 'Keep this note' }, lastPly: 3, review: { version: 1, engine: 'test', depth: 12, results: [], completed: true } };
    const importedAgain = associateGames([game()], 'rival');
    const merged = mergeAccountGames([original], importedAgain);
    expect(merged).toHaveLength(1);
    expect(accountNames(merged[0])).toEqual(['ash', 'rival']);
    expect(merged[0].notes?.[1]).toBe('Keep this note');
    expect(merged[0].review?.completed).toBe(true);
    expect(merged[0].lastPly).toBe(3);
    expect(groupAccountGames(merged, 'ash').map(group => group.games.length)).toEqual([1, 1]);
  });
  it('migrates only matching legacy imports and never guesses a main account', () => {
    const own = game(), unrelated = game('someone', 'else'), file = { ...game(), id: 'file', source: 'PGN' };
    const migrated = migrateLegacyAccount([own, unrelated, file], 'ASH');
    expect(accountNames(migrated[0])).toEqual(['ash']);
    expect(accountNames(migrated[1])).toEqual([]);
    expect(accountNames(migrated[2])).toEqual([]);
    expect(groupAccountGames(migrated).every(group => group.kind !== 'main')).toBe(true);
    expect(migrateLegacyAccount(migrated, 'ash')).toBe(migrated);
  });
});

describe('main account syncing', () => {
  it('deduplicates simultaneous checks and throttles automatic focus/interval checks', async () => {
    let now = 10_000;
    let resolve!: (games: Game[]) => void;
    const fetchGames = vi.fn(() => new Promise<Game[]>(done => { resolve = done; }));
    const commit = vi.fn();
    const sync = new AccountSyncCoordinator({ fetchGames, commit, now: () => now, onState: () => {} });
    const first = sync.sync('ash'), second = sync.sync('ASH');
    expect(first).toBe(second);
    await Promise.resolve();
    expect(fetchGames).toHaveBeenCalledTimes(1);
    resolve([game()]);
    const result = await first;
    expect(accountNames(result[0])).toEqual(['ash']);
    expect(commit).toHaveBeenCalledTimes(1);
    now += SYNC_INTERVAL - 1;
    await sync.sync('ash');
    expect(fetchGames).toHaveBeenCalledTimes(1);
    expect(sync.snapshot('ash').lastSynced).toBe(10_000);
  });
  it('skips hidden/offline checks and backs off repeated errors without deleting saved games', async () => {
    let now = 10_000;
    const fetchGames = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    const commit = vi.fn();
    const sync = new AccountSyncCoordinator({ fetchGames, commit, now: () => now, onState: () => {} });
    await sync.sync('ash', { eligible: false });
    expect(fetchGames).not.toHaveBeenCalled();
    await expect(sync.sync('ash')).rejects.toThrow('Network unavailable');
    expect(sync.snapshot('ash').nextCheck).toBe(now + SYNC_INTERVAL);
    now += SYNC_INTERVAL - 1;
    await sync.sync('ash');
    expect(fetchGames).toHaveBeenCalledTimes(1);
    now++;
    await expect(sync.sync('ash')).rejects.toThrow();
    expect(sync.snapshot('ash').nextCheck).toBe(now + SYNC_INTERVAL * 2);
    expect(commit).not.toHaveBeenCalled();
  });
  it('honours the last successful check persisted across app launches', async () => {
    const fetchGames = vi.fn().mockResolvedValue([game()]);
    const sync = new AccountSyncCoordinator({ fetchGames, commit: () => {}, now: () => 150_000, hydrate: () => 100_000, onState: () => {} });
    await sync.sync('ash');
    expect(fetchGames).not.toHaveBeenCalled();
    expect(sync.snapshot('ash').lastSynced).toBe(100_000);
  });
  it('uses public import caching during an explicit refresh and merges an updated library safely', async () => {
    const globals = globalThis as unknown as { chessash?: unknown };
    const original = globals.chessash;
    const name = 'sync-fixture';
    const apiFetch = vi.fn(async (url: string) => url.endsWith('/archives') ? { archives: [`https://api.chess.com/pub/player/${name}/games/2026/11`] } : { games: [{ pgn: game(name).pgn, url: 'https://www.chess.com/game/live/1234', end_time: 1, rules: 'chess', time_class: 'rapid' }] });
    globals.chessash = { apiFetch };
    let library: Game[] = [];
    const sync = new AccountSyncCoordinator({ fetchGames: importChessCom, commit: incoming => { library = mergeAccountGames(library, incoming); }, onState: () => {} });
    try {
      await sync.sync(name);
      library[0].notes = { 1: 'My annotation' };
      await sync.sync(name, { manual: true });
      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(library).toHaveLength(1);
      expect(library[0].notes?.[1]).toBe('My annotation');
      expect(accountNames(library[0])).toEqual([name]);
    } finally { globals.chessash = original; }
  });
});
