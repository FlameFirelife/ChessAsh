import { parsePgn, mergeGames } from './pgn';
import type { Game } from './types';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

interface CachedResponse { expires: number; value: unknown; }
const responseCache = new Map<string, CachedResponse>();

async function api<T>(url: string): Promise<T> {
  const cached = responseCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  const desktop = (globalThis as unknown as { chessash?: { apiFetch?: (url: string) => Promise<unknown> } }).chessash;
  if (desktop?.apiFetch) {
    const value = await desktop.apiFetch(url);
    responseCache.set(url, { expires: Date.now() + 60000, value });
    return value as T;
  }
  if (Capacitor.isNativePlatform()) {
    const nativeResponse = await CapacitorHttp.get({ url, headers: { Accept: 'application/json' }, connectTimeout: 30000, readTimeout: 30000 });
    if (nativeResponse.status !== 200) throw new Error(`Chess.com returned ${nativeResponse.status}. Try later or import PGN.`);
    const value = nativeResponse.data;
    const cacheControl = Object.entries(nativeResponse.headers).find(([key]) => key.toLowerCase() === 'cache-control')?.[1];
    const maxAge = Number(cacheControl?.match(/max-age=(\d+)/)?.[1] || 60);
    responseCache.set(url, { expires: Date.now() + maxAge * 1000, value });
    return value as T;
  }
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    if (response.status === 404) throw new Error('Chess.com could not find this username or game archive.');
    if (response.status === 429) throw new Error('Chess.com is limiting requests. Wait a few minutes and try again.');
    throw new Error(`Chess.com returned ${response.status}. Try again later or import a PGN.`);
  }
  const value = await response.json();
  const maxAge = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] || 60);
  responseCache.set(url, { expires: Date.now() + maxAge * 1000, value });
  return value as T;
}

export async function importChessCom(username: string, onProgress?: (message: string) => void, months = 3): Promise<Game[]> {
  const name = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(name)) throw new Error('Enter a Chess.com username using letters, numbers, underscores or hyphens.');
  onProgress?.('Finding public game archives…');
  const archive = await api<{ archives: string[] }>(`https://api.chess.com/pub/player/${encodeURIComponent(name)}/games/archives`);
  const urls = archive.archives.slice(-Math.max(1, Math.min(240, months))).reverse();
  let games: Game[] = [];
  for (const [index, url] of urls.entries()) {
    if (!/^https:\/\/api\.chess\.com\/pub\/player\/[a-z0-9_-]+\/games\/\d{4}\/\d{2}$/i.test(url)) continue;
    onProgress?.(`Importing archive ${index + 1} of ${urls.length}…`);
    const archiveGames = await api<{ games: Array<{ pgn?: string; url?: string; end_time?: number; rules?: string; time_class?: string }> }>(url);
    const incoming: Game[] = [];
    for (const record of archiveGames.games) {
      if (!record.pgn || !record.end_time || (record.rules && record.rules !== 'chess')) continue;
      try {
        const game = parsePgn(record.pgn, 'Chess.com');
        game.url = record.url;
        game.timeClass = record.time_class;
        incoming.push(game);
      } catch {}
    }
    games = mergeGames(games, incoming);
  }
  if (!games.length) throw new Error('No completed standard chess games were found in these archives. You can import a PGN instead.');
  return games;
}
