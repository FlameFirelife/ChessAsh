import { expect, it } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { importChessCom } from '../src/core/importer';
import { mergeGames } from '../src/core/pgn';

it.skipIf(process.env.CHESSASH_LIVE_IMPORT !== '1')('imports a real public completed-game archive and deduplicates it', async () => {
  const requested: Array<{ url: string; status: number; count?: number }> = [];
  const original = (globalThis as unknown as { chessash?: unknown }).chessash;
  (globalThis as unknown as { chessash?: unknown }).chessash = {
    apiFetch: async (url: string) => {
      const response = await fetch(url, { headers: { 'User-Agent': 'ChessAsh/1.0 (local import verification)' }, signal: AbortSignal.timeout(30000) });
      const body = await response.json();
      requested.push({ url, status: response.status, count: body.games?.length || body.archives?.length });
      if (!response.ok) throw new Error(`Public API returned ${response.status}`);
      return body;
    },
  };
  try {
    const games = await importChessCom('erik', undefined, 1);
    expect(games.length).toBeGreaterThan(0);
    expect(games.every(game => game.positions.length === game.moves.length + 1 && game.source === 'Chess.com')).toBe(true);
    expect(games.every(game => game.url?.startsWith('https://www.chess.com/game/'))).toBe(true);
    const repeated = await importChessCom('erik', undefined, 1);
    expect(mergeGames(games, repeated)).toHaveLength(games.length);
    expect(requested).toHaveLength(2);
    await mkdir('work', { recursive: true });
    const report = { verifiedAt: new Date().toISOString(), username: 'erik', requested, imported: games.length, deduplicated: mergeGames(games, repeated).length, sample: { white: games[0].headers.White, black: games[0].headers.Black, moves: games[0].moves.length, result: games[0].headers.Result, url: games[0].url } };
    await writeFile('work/import-verification.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { (globalThis as unknown as { chessash?: unknown }).chessash = original; }
}, 60000);
