import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { importLichess, lichessGameId, parseLichessGames } from '../src/core/importer';
import { parsePgn } from '../src/core/pgn';
import { associateGames, groupAccountGames, mergeAccountGames } from '../src/accounts/model';
import { playerColorFor } from '../src/core/perspective';
import { trainingStorageKey } from '../src/core/training';
const { publicApi } = createRequire(import.meta.url)('../electron/public-api.cjs');
const pgn = '[Event "Lichess test"]\n[Site "https://lichess.org/AbCd1234"]\n[White "sameuser"]\n[Black "rival"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0';
const record = { id: 'AbCd1234', pgn, variant: 'standard', status: 'resign', speed: 'rapid' };
afterEach(() => vi.unstubAllGlobals());
describe('Lichess imports', () => {
  it('parses NDJSON, deduplicates and retains standard finished games only', () => {
    const data = [record, record, { ...record, variant: 'chess960' }, { ...record, status: 'started' }, { ...record, pgn: pgn.replaceAll('1-0', '*') }].map(r => JSON.stringify(r)).join('\n');
    const games = parseLichessGames(data);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ id: 'lichess:AbCd1234', source: 'Lichess', url: 'https://lichess.org/AbCd1234', timeClass: 'rapid' });
    expect(parsePgn(pgn).id).toBe(games[0].id);
    expect(groupAccountGames(games)[0].title).toBe('Lichess games');
  });
  it('uses canonical public IDs and rejects other hosts, schemes and malformed links', () => {
    expect(lichessGameId('https://lichess.org/AbCd1234wxyz/black#23')).toBe('AbCd1234');
    expect(lichessGameId('https://lichess.org/game/AbCd1234/white')).toBe('AbCd1234');
    expect(parseLichessGames({ ...record, pgn: pgn.replace('lichess.org/AbCd1234', 'lichess.org/game/AbCd1234') })[0].id).toBe('lichess:AbCd1234');
    for (const link of ['https://evil.test/AbCd1234', 'http://lichess.org/AbCd1234', 'https://lichess.org/study/AbCd1234', 'https://user@lichess.org/AbCd1234', 'https://lichess.org:8443/AbCd1234']) expect(() => lichessGameId(link)).toThrow();
  });
  it('requests bounded finished exports and supports a game link without a username', async () => {
    const apiFetch = vi.fn(async (url: string) => url.includes('/game/export/') ? record : JSON.stringify(record));
    vi.stubGlobal('chessash', { apiFetch });
    expect(await importLichess('fixture-player')).toHaveLength(1);
    const url = new URL(apiFetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/games/user/fixture-player');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ max: '300', ongoing: 'false', finished: 'true', pgnInJson: 'true' });
    expect(await importLichess('', undefined, 3, 'https://lichess.org/AbCd1234/black')).toHaveLength(1);
    expect(apiFetch.mock.calls[1][0]).toContain('/game/export/AbCd1234?');
  });
  it('keeps the same username on different sites separate, including perspective and practice history', () => {
    const lichess = associateGames(parseLichessGames(record), 'lichess:sameuser');
    const chess = associateGames([parsePgn(pgn.replace('https://lichess.org/AbCd1234', '?'), 'Chess.com')], 'sameuser');
    const merged = mergeAccountGames(chess, lichess);
    expect(groupAccountGames(merged).map(group => group.id).sort()).toEqual(['lichess:sameuser', 'sameuser']);
    expect(playerColorFor(lichess[0], 'lichess:sameuser')).toBe('w');
    expect(playerColorFor(lichess[0], 'sameuser')).toBeUndefined();
    expect(playerColorFor(chess[0], 'lichess:sameuser')).toBeUndefined();
    expect(trainingStorageKey('sameuser')).not.toBe(trainingStorageKey('lichess:sameuser'));
    lichess[0].notes = { 1: 'Keep my note' };
    expect(mergeAccountGames(lichess, associateGames(parseLichessGames(record), 'lichess:rival'))[0].notes).toEqual({ 1: 'Keep my note' });
  });
  it('keeps the native bridge limited to public exports', () => {
    const valid = 'https://lichess.org/api/games/user/ash?max=300&ongoing=false&finished=true&pgnInJson=true';
    expect(publicApi(valid)).toMatchObject({ provider: 'Lichess', ndjson: true });
    expect(publicApi('https://lichess.org/game/export/AbCd1234?pgnInJson=true').ndjson).toBe(false);
    for (const url of [valid.replace('max=300', 'max=99999'), valid.replace('ongoing=false', 'ongoing=true'), valid+'&players=https://evil.test/', 'https://lichess.org/api/account', 'https://lichess.org.evil.test/game/export/AbCd1234']) expect(() => publicApi(url)).toThrow();
  });
});
