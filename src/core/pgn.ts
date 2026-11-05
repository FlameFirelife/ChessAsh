import { Chess } from 'chess.js';
import { LABEL_INFO } from './policy';
import type { Game } from './types';

function stableId(text: string): string {
  let hash = 2166136261;
  let second = 5381;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(index);
  }
  return 'game-' + (hash >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
}

export function parsePgn(pgn: string, source = 'PGN'): Game {
  if (!pgn.trim() || pgn.length > 2_000_000) throw new Error('Choose a non-empty PGN smaller than 2 MB.');
  const variant = pgn.match(/\[Variant\s+"([^"]+)"\]/i)?.[1];
  if (variant && !['standard', 'chess', 'normal'].includes(variant.toLowerCase())) {
    throw new Error(`The ${variant} variant is not supported. Import a standard chess game.`);
  }
  const chess = new Chess();
  try { chess.loadPgn(pgn); }
  catch (error) { throw new Error('Invalid PGN: ' + (error instanceof Error ? error.message : 'the moves could not be read.')); }
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  if (!history.length) throw new Error('This PGN has no moves to review.');
  const initial = headers.FEN || new Chess().fen();
  const positions = [initial, ...history.map(move => move.after)];
  const normalized = chess.pgn();
  const url = /^https:\/\/(www\.)?chess\.com\//i.test(headers.Link || headers.Site || '') ? headers.Link || headers.Site : undefined;
  return {
    id: stableId(JSON.stringify([headers.White, headers.Black, headers.Date, headers.UTCDate, headers.UTCTime, headers.Link, history.map(move => move.lan), initial])),
    pgn: normalized, headers, moves: history.map(move => move.san), positions, source, url, importedAt: Date.now(),
  };
}

export function parsePgnCollection(text: string, source = 'PGN'): Game[] {
  const chunks = text.replace(/^\uFEFF/, '').split(/(?=^\[Event\s+")/m).filter(chunk => chunk.trim());
  return chunks.map(chunk => parsePgn(chunk, source));
}

export function exportPgn(game: Game): string {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  while (chess.undo()) {}
  const initialComment = game.notes?.[0];
  if (initialComment) chess.setComment(initialComment);
  for (let ply = 1; ply <= game.moves.length; ply++) {
    chess.move(game.moves[ply - 1]);
    const result = game.review?.results.find(item => item.ply === ply);
    const comments: string[] = [];
    if (result) comments.push(`ChessAsh: ${LABEL_INFO[result.label].name}. ${result.explanation} [%eval ${(result.after / 100).toFixed(2)}]`);
    if (game.notes?.[ply]) comments.push(game.notes[ply]);
    if (comments.length) chess.setComment(comments.join(' '));
  }
  return chess.pgn({ maxWidth: 88 });
}

export function playUci(fen: string, uci: string): { fen: string; san: string } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return move ? { fen: chess.fen(), san: move.san } : null;
  } catch { return null; }
}

export function variationSan(fen: string, moves: string[]): string[] {
  const chess = new Chess(fen);
  const result: string[] = [];
  for (const uci of moves) {
    try {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      result.push(move.san);
    } catch { break; }
  }
  return result;
}

export function extractChessComGameId(url: string): string | null {
  const match = url.trim().match(/^https:\/\/(?:www\.)?chess\.com\/game\/(?:live|daily)\/(\d+)(?:[/?#]|$)/i);
  return match?.[1] || null;
}

export function mergeGames(existing: Game[], incoming: Game[]): Game[] {
  const merged = new Map(existing.map(game => [game.id, game]));
  for (const game of incoming) {
    const previous = merged.get(game.id);
    merged.set(game.id, previous ? { ...game, ...previous, accountUsernames: [...new Set([...(previous.accountUsernames || []), ...(game.accountUsernames || [])])], headers: { ...game.headers, ...previous.headers } } : game);
  }
  return [...merged.values()].sort((a, b) => {
    const dateA = [a.headers.UTCDate || a.headers.Date || '', a.headers.UTCTime || ''].join(' ');
    const dateB = [b.headers.UTCDate || b.headers.Date || '', b.headers.UTCTime || ''].join(' ');
    return dateB.localeCompare(dateA) || (b.importedAt || 0) - (a.importedAt || 0);
  });
}
