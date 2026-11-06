import { Chess } from 'chess.js';
import { analyzeGame } from './analysis';
import type { AnalyzeOptions, Game, MoveReview } from './types';

export async function reviewVariationMove(
  fen: string,
  uci: string,
  options: { depth?: number; signal?: AbortSignal; classify?: AnalyzeOptions['classify'] } = {},
): Promise<{ game: Game; result: MoveReview }> {
  if (options.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Choose a legal move on the board.');
  const board = new Chess(fen);
  const before = board.fen();
  const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const game: Game = {
    id: `variation:${before}:${move.lan}`,
    pgn: board.pgn(),
    headers: board.getHeaders(),
    moves: [move.san],
    positions: [before, board.fen()],
    source: 'variation',
  };
  const review = await analyzeGame(game, options);
  if (options.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
  const result = review.results[0];
  if (!review.completed || !result) throw new Error('The move review did not finish. Try again.');
  return { game, result };
}
