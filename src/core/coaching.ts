import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import type { Game, MoveReview } from './types';

const names: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
function play(board: Chess, uci: string): Move | undefined {
  try { return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return undefined; }
}
export function describeMove(fen: string, uci: string): string {
  const board = new Chess(fen);
  const move = play(board, uci);
  if (!move) return '';
  if (move.isKingsideCastle() || move.isQueensideCastle()) return `castle ${move.isKingsideCastle() ? 'towards the king’s rook' : 'towards the queen’s rook'} (king to ${move.to}, rook to ${move.isKingsideCastle() ? 'f' : 'd'}${move.from[1]})`;
  const target = move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to;
  return `move the ${names[move.piece]} from ${move.from} to ${move.to}${move.captured ? `, taking the ${names[move.captured]} on ${target}${move.isEnPassant() ? ' as it passes (en passant)' : ''}` : ''}${move.promotion ? ` and promote it to a ${names[move.promotion]}` : ''}${board.isCheckmate() ? ', delivering checkmate' : board.isCheck() ? ', putting the king in check' : ''}`;
}
export function reviewCoaching(game: Game, result: MoveReview) {
  const before = game.positions[result.ply - 1];
  const after = game.positions[result.ply];
  const board = new Chess(after);
  const played = describeMove(before, result.move);
  const best = describeMove(before, result.best);
  const same = result.move === result.best;
  const bestBoard = new Chess(before);
  const bestMove = play(bestBoard, result.best);
  const bestReply = bestMove && result.pv?.[0] === result.best && result.pv[1] ? describeMove(bestBoard.fen(), result.pv[1]) : '';
  const moved = board.get(result.move.slice(2, 4) as Square);
  const attacks = moved ? board.board().flat().filter(p => p && p.color !== moved.color && board.attackers(p.square, moved.color).includes(result.move.slice(2, 4) as Square)).map(p => ({ square: p!.square, name: names[p!.type] })) : [];
  const replyBoard = new Chess(after);
  const reply = result.replyPv?.[0];
  const response = reply ? play(replyBoard, reply) : undefined;
  const threat = response && (response.captured || replyBoard.isCheck()) ? reply : undefined;
  const outcome = board.isCheckmate() ? 'The king has no escape: checkmate.'
    : board.isStalemate() ? 'The opponent has no legal move and their king is safe. The game is a draw by stalemate.'
    : attacks.length ? `From ${result.move.slice(2, 4)}, the ${names[moved!.type]} attacks ${attacks.map(a => `the ${a.name} on ${a.square}`).join(' and ')}. An attack alone does not mean the piece can be won.`
    : result.label === 'book' ? 'This is part of a recognised opening sequence.'
    : result.label === 'sacrifice' ? 'The checked continuation gives up material while keeping enough chances to justify it.'
    : result.label === 'great' ? 'The next option the engine checked was much weaker.'
    : same ? 'This is the strongest move found at this analysis depth.'
    : result.loss < 45 ? 'This keeps the position close to the strongest option.'
    : 'Compare the best move with what was played to see how the replies change.';
  const responseText = threat ? `The opponent can ${describeMove(after, threat)}.` : '';
  return {
    text: `${same ? '' : `${result.color === 'w' ? 'White' : 'Black'} chose to ${played}. `}${outcome}${responseText ? ' ' + responseText : ''}`,
    best: best ? `${same ? 'Best move, also played' : 'Best move'}: ${best}.${bestReply && !(same && threat) ? ` One checked response is to ${bestReply}.` : ''}` : 'No legal continuation is available.',
    threat,
    targets: attacks.map(a => a.square),
    played,
  };
}
