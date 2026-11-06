import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import type { Game, MoveReview } from './types';

type Language = 'en' | 'it';
export type CoachingOptions = { language?: Language; playerColor?: 'w' | 'b' };
const names = {
  en: { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' },
  it: { p: 'pedone', n: 'cavallo', b: 'alfiere', r: 'torre', q: 'donna', k: 're' },
};
function pieceName(piece: string, language: Language) { return names[language][piece as keyof typeof names.en] || (language === 'it' ? 'pezzo' : 'piece'); }
function play(board: Chess, uci: string): Move | undefined {
  try { return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return undefined; }
}
function actor(color: 'w' | 'b', options: CoachingOptions) {
  const it = options.language === 'it';
  if (options.playerColor === color) return it ? 'Tu' : 'You';
  if (options.playerColor) return it ? 'Il tuo avversario' : 'Your opponent';
  return it ? color === 'w' ? 'Il Bianco' : 'Il Nero' : color === 'w' ? 'White' : 'Black';
}
function pieceAt(piece: string, color: 'w' | 'b', square: string, options: CoachingOptions) {
  const language = options.language || 'en';
  const name = pieceName(piece, language);
  if (language === 'it') {
    const feminine = piece === 'q' || piece === 'r';
    const article = feminine ? 'la' : 'il';
    if (options.playerColor === color) return `${article} ${feminine ? 'tua' : 'tuo'} ${name} in ${square}`;
    const noun = piece === 'b' ? `l’${name}` : `${article} ${name}`;
    if (options.playerColor) return `${noun} del tuo avversario in ${square}`;
    return `${noun} ${color === 'w' ? feminine ? 'bianca' : 'bianco' : feminine ? 'nera' : 'nero'} in ${square}`;
  }
  return `${options.playerColor === color ? 'your' : options.playerColor ? 'your opponent’s' : color === 'w' ? 'White’s' : 'Black’s'} ${name} on ${square}`;
}
function capitalise(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }
export function describeMove(fen: string, uci: string, options: CoachingOptions = {}): string {
  const board = new Chess(fen);
  const move = play(board, uci);
  if (!move) return '';
  const language = options.language || 'en';
  const it = language === 'it';
  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    const rook = `${move.isKingsideCastle() ? 'f' : 'd'}${move.from[1]}`;
    return it ? `arroccare ${move.isKingsideCastle() ? 'corto' : 'lungo'} (re in ${move.to}, torre in ${rook})` : `castle ${move.isKingsideCastle() ? 'towards the king’s rook' : 'towards the queen’s rook'} (king to ${move.to}, rook to ${rook})`;
  }
  const target = move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to;
  if (it) {
    const own = options.playerColor === move.color;
    const feminine = move.piece === 'q' || move.piece === 'r';
    const piece = !own && move.piece === 'b' ? 'l’alfiere' : `${feminine ? 'la' : 'il'} ${own ? feminine ? 'tua ' : 'tuo ' : ''}${pieceName(move.piece, language)}`;
    const capturedFeminine = move.captured === 'q' || move.captured === 'r';
    return `spostare ${piece} da ${move.from} a ${move.to}${move.captured ? `, prendendo ${move.captured === 'b' ? 'l’alfiere' : `${capturedFeminine ? 'la' : 'il'} ${pieceName(move.captured, language)}`} in ${target}${move.isEnPassant() ? ' con la presa en passant' : ''}` : ''}${move.promotion ? ` e promuovere a ${pieceName(move.promotion, language)}` : ''}${board.isCheckmate() ? ', dando scacco matto' : board.isCheck() ? ', dando scacco' : ''}`;
  }
  return `move ${options.playerColor === move.color ? 'your' : 'the'} ${pieceName(move.piece, language)} from ${move.from} to ${move.to}${move.captured ? `, taking the ${pieceName(move.captured, language)} on ${target}${move.isEnPassant() ? ' as it passes (en passant)' : ''}` : ''}${move.promotion ? ` and promote it to a ${pieceName(move.promotion, language)}` : ''}${board.isCheckmate() ? ', delivering checkmate' : board.isCheck() ? ', putting the king in check' : ''}`;
}
function sentence(fen: string, uci: string, options: CoachingOptions, past = false) {
  const board = new Chess(fen);
  const color = board.turn();
  const description = describeMove(fen, uci, options);
  if (!description) return '';
  const who = actor(color, options);
  if (options.language === 'it') {
    if (!past) return `${options.playerColor === color ? 'Puoi' : who + ' può'} ${description}.`;
    const action = description.replace(/^spostare/, 'spostato').replace(/^arroccare/, 'arroccato').replace(' e promuovere', ' e promosso');
    return `${options.playerColor === color ? 'Hai' : who + ' ha'} ${action}.`;
  }
  return past ? `${who} ${description.replace(/^move/, 'moved').replace(/^castle/, 'castled').replace(' and promote', ' and promoted')}.` : `${who} can ${description}.`;
}
export function reviewCoaching(game: Game, result: MoveReview, options: CoachingOptions = {}) {
  const before = game.positions[result.ply - 1];
  const after = game.positions[result.ply];
  const board = new Chess(after);
  const it = options.language === 'it';
  const same = result.move === result.best;
  const played = describeMove(before, result.move, options);
  const best = describeMove(before, result.best, options);
  const bestBoard = new Chess(before);
  const bestMove = play(bestBoard, result.best);
  const replyBoard = new Chess(after);
  const reply = result.replyPv?.[0];
  const response = reply ? play(replyBoard, reply) : undefined;
  const threat = response && (response.captured || replyBoard.isCheck()) ? reply : undefined;
  const moved = board.get(result.move.slice(2, 4) as Square);
  const attacks = moved ? board.board().flat().filter(p => p && p.color !== moved.color && board.attackers(p.square, moved.color).includes(result.move.slice(2, 4) as Square)).map(p => ({ square: p!.square, piece: p!.type, color: p!.color })) : [];
  const forced = new Chess(before).moves().length === 1;
  const losesChances = !same && !forced && result.loss >= 45;
  const mover = actor(result.color, options);
  let text: string;
  if (board.isCheckmate()) text = it ? `${options.playerColor === result.color ? 'Hai dato' : mover + ' ha dato'} scacco matto. Il re non ha vie di fuga.` : `${options.playerColor === result.color ? 'You delivered' : mover + ' delivered'} checkmate. The king has no escape.`;
  else if (board.isStalemate()) text = it ? 'È stallo: il re non è sotto scacco, ma non ci sono mosse legali. La partita è patta.' : 'This is stalemate: the king is safe, but there are no legal moves. The game is a draw.';
  else if (forced) text = it ? 'Questa era l’unica mossa legale.' : 'This was the only legal move.';
  else if (!same && bestMove && bestBoard.isCheckmate()) text = it ? `${options.playerColor === result.color ? 'Hai mancato' : mover + ' ha mancato'} uno scacco matto immediato.` : `${options.playerColor === result.color ? 'You missed' : mover + ' missed'} an immediate checkmate.`;
  else if (losesChances && response && replyBoard.isCheckmate()) text = it ? 'Questa mossa permette uno scacco matto immediato.' : 'This move allows an immediate checkmate.';
  else if (losesChances && response?.captured) {
    const target = response.isEnPassant() ? response.to[0] + response.from[1] : response.to;
    text = it ? `${actor(response.color, options) === 'Tu' ? 'Puoi' : actor(response.color, options) + ' può'} prendere ${pieceAt(response.captured, result.color, target, options)}.` : `${actor(response.color, options)} can capture ${pieceAt(response.captured, result.color, target, options)}.`;
  } else if (result.label === 'sacrifice') text = it ? 'Il sacrificio mantiene buone possibilità nella continuazione analizzata.' : 'The sacrifice keeps good chances in the checked continuation.';
  else if (result.label === 'great') text = it ? `${options.playerColor === result.color ? 'Hai trovato' : mover + ' ha trovato'} la mossa decisiva: le alternative analizzate erano molto più deboli.` : `${options.playerColor === result.color ? 'You found' : mover + ' found'} the critical move: the checked alternatives were much weaker.`;
  else if (!losesChances && attacks.length) {
    const target = attacks[0];
    text = it ? `${capitalise(pieceAt(moved!.type, moved!.color, result.move.slice(2, 4), options))} attacca ${pieceAt(target.piece, target.color, target.square, options)}.` : `${capitalise(pieceAt(moved!.type, moved!.color, result.move.slice(2, 4), options))} attacks ${pieceAt(target.piece, target.color, target.square, options)}.`;
  } else if (result.label === 'book') text = it ? 'Questa mossa segue una sequenza d’apertura conosciuta.' : 'This move follows a recognised opening sequence.';
  else if (same) text = it ? `${options.playerColor === result.color ? 'Hai scelto' : mover + ' ha scelto'} la mossa migliore trovata nell’analisi.` : `${options.playerColor === result.color ? 'You chose' : mover + ' chose'} the strongest move found in the analysis.`;
  else if (result.loss < 45) text = it ? 'Una buona mossa: mantiene quasi tutte le possibilità della posizione.' : 'A sound move: it keeps most of the position’s chances.';
  else text = it ? 'C’era una mossa più forte. Confronta la continuazione per vedere la differenza.' : 'There was a stronger move. Compare the continuation to see the difference.';
  const details = [sentence(before, result.move, options, true)];
  if (threat) details.push(sentence(after, threat, options));
  if (attacks.length) details.push(it ? 'Un pezzo attaccato non è sempre un pezzo che si può vincere: contano anche le risposte.' : 'An attacked piece is not always a piece that can be won; the replies matter too.');
  if (bestMove && result.pv?.[0] === result.best && result.pv[1]) {
    const bestReply = sentence(bestBoard.fen(), result.pv[1], options);
    if (bestReply && !(same && threat === result.pv[1])) details.push((it ? 'Dopo la mossa migliore: ' : 'After the best move: ') + bestReply);
  }
  if (!forced && losesChances) details.push(it ? 'La mossa suggerita conserva più possibilità secondo l’analisi. Puoi giocare la continuazione sulla scacchiera.' : 'The suggested move keeps better chances in the analysis. Play through the continuation on the board.');
  return {
    text,
    best: best ? `${it ? same ? 'Mossa migliore, anche giocata' : 'Mossa migliore' : same ? 'Best move, also played' : 'Best move'}: ${best}.` : it ? 'La mossa migliore non è ancora disponibile.' : 'The best move is not available yet.',
    detail: details.filter(Boolean).join(' '),
    threat,
    targets: attacks.map(a => a.square),
    played,
  };
}
