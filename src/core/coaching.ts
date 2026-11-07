import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import type { Game, MoveReview } from './types';
import { findMoveInsights } from './moveInsight';
import type { MoveInsight } from './moveInsight';
import { alternativeHelp } from './alternativeHelp';
import type { AlternativeHelp } from './alternativeHelp';

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
export function explainAlternativeHelp(help: AlternativeHelp, options: CoachingOptions = {}) {
  const it = options.language === 'it';
  const target = pieceAt(help.piece.type, help.piece.color, help.piece.square, options);
  const related = help.related ? pieceAt(help.related.type, help.related.color, help.related.square, options) : '';
  switch (help.kind) {
    case 'mate': return it ? 'La variante termina subito con scacco matto.' : 'The alternative finishes the game immediately with checkmate.';
    case 'stalemate': return it ? 'La mossa suggerita conclude la partita con una patta per stallo.' : 'The alternative ends the game in a draw by stalemate.';
    case 'removes-attacker': return it ? `La mossa suggerita elimina ${target} prima che possa realizzare la minaccia.` : `The alternative removes ${target} before it can carry out the threat.`;
    case 'preserves-defense': return it ? `La mossa suggerita mantiene la difesa di ${target}.` : `The alternative keeps ${target} defended.`;
    case 'escapes-capture': return it ? `In ${help.move.to}, questo pezzo non può essere preso subito con una mossa legale.` : `On ${help.move.to}, this piece cannot be captured immediately by a legal reply.`;
    case 'keeps-line-closed': return it ? `La mossa suggerita mantiene ${target} sulla linea verso ${related}, bloccandola.` : `The alternative keeps ${target} blocking the line toward ${related}.`;
    case 'avoids-fork': return it ? `Con il pezzo in ${help.move.to}, ${help.replySAN} non lo attacca più nella forchetta.` : `With the piece on ${help.move.to}, ${help.replySAN} no longer attacks it as part of the fork.`;
    case 'avoids-pin': return it ? `Il re in ${help.piece.square} esce dalla linea: dopo ${help.replySAN}, ${related} non è più inchiodato.` : `The king on ${help.piece.square} is off the line: after ${help.replySAN}, ${related} is no longer pinned.`;
    case 'answers-check': return it ? `${capitalise(target)} blocca la linea di scacco di ${related}.` : `${capitalise(target)} blocks the checking line from ${related}.`;
    case 'gives-check': return it ? 'La mossa dà scacco: l’avversario deve prima rispondere alla minaccia al re.' : 'The move comes with check, so the opponent must answer the threat to the king first.';
    case 'unrecaptured-capture': return it ? `La mossa prende ${target} senza consentire una ripresa immediata.` : `The move captures ${target} without allowing an immediate recapture.`;
  }
}
function briefAlternativeHelp(help: AlternativeHelp, options: CoachingOptions) {
  const it = options.language === 'it';
  const reasons = {
    mate: ['Checkmate.', 'Scacco matto.'],
    stalemate: ['Draw by stalemate.', 'Patta per stallo.'],
    'removes-attacker': ['Removes the attacker.', 'Elimina il pezzo attaccante.'],
    'preserves-defense': [`Keeps the ${pieceName(help.piece.type, 'en')} on ${help.piece.square} defended.`, `Mantiene difeso il pezzo in ${help.piece.square}.`],
    'escapes-capture': ['Avoids an immediate capture.', 'Evita una presa immediata.'],
    'keeps-line-closed': ['Keeps the line blocked.', 'Mantiene la linea chiusa.'],
    'avoids-fork': ['Steps out of the fork.', 'Esce dalla forchetta.'],
    'avoids-pin': ['Steps out of the pin.', 'Esce dall’inchiodatura.'],
    'answers-check': ['Blocks the check.', 'Blocca lo scacco.'],
    'gives-check': ['Gives check.', 'Dà scacco.'],
    'unrecaptured-capture': ['No immediate recapture.', 'Nessuna ripresa immediata.'],
  };
  return reasons[help.kind][it ? 1 : 0];
}
export function explainMoveInsight(insight: MoveInsight, options: CoachingOptions = {}, variant = 0) {
  const it = options.language === 'it', { moved, reply, targets, kind } = insight;
  const target = pieceAt(targets[0].type, targets[0].color, targets[0].square, options);
  const moving = pieceAt(moved.piece, moved.color, moved.from, options);
  const attacker = pieceAt(reply.piece, reply.color, reply.to, options);
  const pick = (english: string[], italian: string[]) => (it ? italian : english)[variant % 3];
  let text: string, lesson: string, hint: string;
  if (kind === 'abandoned-defender') {
    text = pick([
      `Moving ${moving} to ${moved.to} leaves ${target} without a defender.`,
      `${capitalise(target)} loses its defender when ${moving} moves to ${moved.to}.`,
      `The problem is the piece left behind: ${target} is no longer defended after ${moved.san}.`,
    ], [
      `Spostare ${moving} in ${moved.to} lascia ${target} senza difensori.`,
      `${capitalise(target)} perde la sua difesa quando ${moving} va in ${moved.to}.`,
      `Il problema è il pezzo lasciato indietro: dopo ${moved.san}, ${target} non ha più difensori.`,
    ]);
    lesson = it ? `Prima di spostare un difensore, controlla quali pezzi proteggeva. Nella variante, ${reply.san} prende il pezzo rimasto senza difesa.` : `Before moving a defender, check what it was protecting. In the line, ${reply.san} captures the piece left without cover.`;
    hint = it ? `Quale pezzo proteggeva ${moving} prima della mossa?` : `What was ${moving} defending before the move?`;
  } else if (kind === 'opened-line') {
    text = pick([
      `Moving ${moving} opens a line toward ${target}.`,
      `${moved.san} clears ${moved.from}, opening access to ${target}.`,
      `The important change is on ${moved.from}: leaving that square opens a line to ${target}.`,
    ], [
      `Spostare ${moving} apre una linea verso ${target}.`,
      `${moved.san} libera ${moved.from}, aprendo una linea verso ${target}.`,
      `Il cambiamento importante è in ${moved.from}: liberare quella casa apre una linea verso ${target}.`,
    ]);
    lesson = it ? `Nella variante analizzata, ${reply.san} sfrutta questa apertura. Controlla anche le linee che lasci libere, non soltanto la casa di arrivo.` : `In the analysed line, ${reply.san} uses that opening. Check the lines you leave clear, as well as the destination square.`;
    hint = it ? `Quale linea si apre passando da ${moved.from} a ${moved.to}?` : `Which line opens when the piece leaves ${moved.from}?`;
  } else if (kind === 'fork') {
    const other = pieceAt(targets[1].type, targets[1].color, targets[1].square, options);
    text = pick([
      `${reply.san} creates a fork against ${target} and ${other}.`,
      `The tactical problem is a double attack: ${reply.san} threatens ${target} and ${other}.`,
      `After ${reply.san}, ${target} and ${other} are attacked by the same piece.`,
    ], [
      `${reply.san} crea una forchetta contro ${target} e ${other}.`,
      `Il problema tattico è un doppio attacco: ${reply.san} minaccia ${target} e ${other}.`,
      `Dopo ${reply.san}, lo stesso pezzo attacca ${target} e ${other}.`,
    ]);
    lesson = it ? 'Prima di scegliere la mossa, cerca le case da cui un pezzo avversario può attaccare due bersagli. Un doppio attacco non garantisce da solo un guadagno: conta anche la risposta.' : 'Look for squares where an opposing piece can attack two targets. A double attack does not by itself prove a material win; the response still matters.';
    hint = it ? `Da quale casa si possono attaccare insieme ${targets[0].square} e ${targets[1].square}?` : `Which square lets one piece attack both ${targets[0].square} and ${targets[1].square}?`;
  } else if (kind === 'pin') {
    text = it ? `${capitalise(attacker)} inchioda ${target} al re in ${targets[1].square}.` : `${capitalise(attacker)} pins ${target} to the king on ${targets[1].square}.`;
    lesson = it ? 'Il pezzo inchiodato non può lasciare questa linea scoprendo il re, anche se può avere mosse legali lungo la linea.' : 'The pinned piece cannot leave this line and expose the king, although it may still have legal moves along the line.';
    hint = it ? `Quale pezzo si trova tra ${reply.to} e il re in ${targets[1].square}?` : `Which piece lies between ${reply.to} and the king on ${targets[1].square}?`;
  } else if (kind === 'back-rank') {
    text = it ? `La variante termina con un matto sull’ultima traversa contro ${target}.` : `The line ends in a back-rank mate against ${target}.`;
    lesson = it ? `I pedoni vicini limitano le fughe del re; ${reply.san} dà matto lungo l’ultima traversa.` : `Nearby friendly pawns restrict the king's escape squares; ${reply.san} delivers mate along the back rank.`;
    hint = it ? 'Quali case di fuga ha il re dietro i propri pedoni?' : 'Which escape squares does the king have behind its own pawns?';
  } else if (kind === 'mate-line') {
    text = it ? `La continuazione analizzata arriva al matto con ${reply.san}.` : `The analysed continuation reaches checkmate with ${reply.san}.`;
    lesson = it ? 'Segui la sequenza: una minaccia di matto può diventare concreta anche dopo mosse preparatorie.' : 'Follow the sequence: a mating threat can become concrete after preparatory moves.';
    hint = it ? 'Quali scacchi avversari riducono le fughe del re?' : "Which opposing checks reduce the king's escape squares?";
  } else {
    text = it ? `${reply.san} può prendere ${target}, che non ha difensori.` : `${reply.san} can capture ${target}, which has no defender.`;
    lesson = it ? 'Prima di creare una minaccia, controlla se lasci un pezzo attaccato senza protezione.' : 'Before creating a threat, check whether you are leaving an attacked piece without protection.';
    hint = it ? `Chi difende il pezzo in ${targets[0].square}?` : `Who defends the piece on ${targets[0].square}?`;
  }
  if (insight.ply > 1 && !['back-rank', 'mate-line'].includes(kind)) text = (it ? 'Nella variante analizzata: ' : 'In the analysed line: ') + text;
  const line = (it ? 'Continuazione analizzata: ' : 'Analysed continuation: ') + insight.line.join(' ') + '.';
  const prevention = insight.preservesDefense ? (it ? `La mossa suggerita mantiene difeso il pezzo in ${targets[0].square}.` : `The suggested move keeps the piece on ${targets[0].square} defended.`) : '';
  return { text, detail: `${lesson} ${line}`, hint, prevention, targets: targets.map(p => p.square) };
}
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
  const bestSummary = bestMove
    ? bestMove.isKingsideCastle() || bestMove.isQueensideCastle()
      ? it ? `arrocco ${bestMove.isKingsideCastle() ? 'corto' : 'lungo'}` : `castle ${bestMove.isKingsideCastle() ? 'kingside' : 'queenside'}`
      : `${pieceName(bestMove.piece, options.language || 'en')} ${bestMove.from} → ${bestMove.to}${bestMove.promotion ? ` = ${pieceName(bestMove.promotion, options.language || 'en')}` : ''}`
    : '';
  const replyBoard = new Chess(after);
  const reply = result.replyPv?.[0];
  const response = reply ? play(replyBoard, reply) : undefined;
  const threat = response && (response.captured || replyBoard.isCheck()) ? reply : undefined;
  const moved = board.get(result.move.slice(2, 4) as Square);
  const attacks = moved ? board.board().flat().filter(p => p && p.color !== moved.color && board.attackers(p.square, moved.color).includes(result.move.slice(2, 4) as Square)).map(p => ({ square: p!.square, piece: p!.type, color: p!.color })) : [];
  const forced = new Chess(before).moves().length === 1;
  const losesChances = !same && !forced && result.loss >= 45;
  const mover = actor(result.color, options);
  const variant = result.ply % 3;
  const insight = losesChances ? findMoveInsights(before, result.move, result.replyPv || [], result.best)[0] : undefined;
  const reasoning = insight ? explainMoveInsight(insight, options, variant) : undefined;
  const help = losesChances ? alternativeHelp(before, result.move, result.best, insight) : undefined;
  const alternativeReason = help ? explainAlternativeHelp(help, options) : '';
  const varied = (en: string[], italian: string[]) => (it ? italian : en)[variant];
  let text: string;
  if (board.isCheckmate()) text = it ? `${options.playerColor === result.color ? 'Hai dato' : mover + ' ha dato'} scacco matto. Il re non ha vie di fuga.` : `${options.playerColor === result.color ? 'You delivered' : mover + ' delivered'} checkmate. The king has no escape.`;
  else if (board.isStalemate()) text = it ? 'È stallo: il re non è sotto scacco, ma non ci sono mosse legali. La partita è patta.' : 'This is stalemate: the king is safe, but there are no legal moves. The game is a draw.';
  else if (forced) text = it ? 'Questa era l’unica mossa legale.' : 'This was the only legal move.';
  else if (!same && bestMove && bestBoard.isCheckmate()) text = it ? `${options.playerColor === result.color ? 'Hai mancato' : mover + ' ha mancato'} uno scacco matto immediato.` : `${options.playerColor === result.color ? 'You missed' : mover + ' missed'} an immediate checkmate.`;
  else if (reasoning) text = reasoning.text;
  else if (losesChances && response && replyBoard.isCheckmate()) text = it ? 'Questa mossa permette uno scacco matto immediato.' : 'This move allows an immediate checkmate.';
  else if (losesChances && response?.captured) {
    const target = response.isEnPassant() ? response.to[0] + response.from[1] : response.to;
    const victim = pieceAt(response.captured, result.color, target, options);    text = varied([`${actor(response.color, options)} can capture ${victim}.`, `The reply ${response.san} captures ${victim}.`, `${capitalise(victim)} can be taken with ${response.san}.`], [`${actor(response.color, options) === 'Tu' ? 'Puoi' : actor(response.color, options) + ' può'} prendere ${victim}.`, `La risposta ${response.san} prende ${victim}.`, `Con ${response.san} si può prendere ${victim}.`]);
  } else if (result.label === 'sacrifice') text = varied(['The sacrifice keeps good chances in the checked continuation.', 'The analysed line supports this material investment.', 'Giving up material here retains compensation in the engine line.'], ['Il sacrificio mantiene buone possibilità nella continuazione analizzata.', 'La variante analizzata sostiene questo investimento di materiale.', 'Cedere materiale qui conserva un compenso nella variante del motore.']);
  else if (result.label === 'great') text = it ? `${options.playerColor === result.color ? 'Hai trovato' : mover + ' ha trovato'} la mossa decisiva: le alternative analizzate erano molto più deboli.` : `${options.playerColor === result.color ? 'You found' : mover + ' found'} the critical move: the checked alternatives were much weaker.`;
  else if (!losesChances && attacks.length) {
    const target = attacks[0];
    const attacking = pieceAt(moved!.type, moved!.color, result.move.slice(2, 4), options), victim = pieceAt(target.piece, target.color, target.square, options);    text = varied([`${capitalise(attacking)} attacks ${victim}.`, `The move brings ${victim} under attack from ${attacking}.`, `${capitalise(victim)} is now attacked by ${attacking}.`], [`${capitalise(attacking)} attacca ${victim}.`, `La mossa mette ${victim} sotto l’attacco di ${attacking}.`, `${capitalise(victim)} ora subisce l’attacco di ${attacking}.`]);
  } else if (result.label === 'book') text = varied(['This move follows a recognised opening sequence.', 'This is part of a known opening sequence.', 'The move stays within a recognised opening line.'], ['Questa mossa segue una sequenza d’apertura conosciuta.', 'Questa mossa fa parte di una sequenza d’apertura nota.', 'La mossa resta in una variante d’apertura riconosciuta.']);
  else if (same) text = varied([`${options.playerColor === result.color ? 'You chose' : mover + ' chose'} the strongest move found in the analysis.`, `${options.playerColor === result.color ? 'You found' : mover + ' found'} the strongest continuation at this search depth.`, `${options.playerColor === result.color ? 'Your move' : mover + '’s move'} is the engine’s preferred choice in this analysis.`], [`${options.playerColor === result.color ? 'Hai scelto' : mover + ' ha scelto'} la mossa migliore trovata nell’analisi.`, 'Questa mossa segue la continuazione migliore trovata a questa profondità.', 'Il motore preferisce questa mossa nell’analisi attuale.']);
  else if (result.loss < 45) text = varied(['A sound move: it keeps most of the position’s chances.', 'This keeps the position close to the preferred continuation.', 'The move gives up little compared with the best line found.'], ['Una buona mossa: mantiene quasi tutte le possibilità della posizione.', 'La posizione rimane vicina alla continuazione preferita.', 'La mossa concede poco rispetto alla variante migliore trovata.']);
  else text = varied(['There was a stronger move. Compare the continuation to see the difference.', 'A stronger move was available; the continuation shows where the difference appears.', 'Compare the replies to find why the engine preferred a stronger move.'], ['C’era una mossa più forte. Confronta la continuazione per vedere la differenza.', 'C’era una mossa più forte: la continuazione mostra dove nasce la differenza.', 'Confronta le risposte per capire perché il motore preferiva una mossa più forte.']);
  const details = [sentence(before, result.move, options, true)];
  if (reasoning) details.push(reasoning.detail);
  if (threat) details.push(sentence(after, threat, options));
  if (attacks.length) details.push(it ? 'Un pezzo attaccato non è sempre un pezzo che si può vincere: contano anche le risposte.' : 'An attacked piece is not always a piece that can be won; the replies matter too.');
  if (best && !same) details.push(`${it ? 'Mossa migliore' : 'Best move'}: ${best}.`);
  if (bestMove && result.pv?.[0] === result.best && result.pv[1]) {
    const bestReply = sentence(bestBoard.fen(), result.pv[1], options);
    if (bestReply && !(same && threat === result.pv[1])) details.push((it ? 'Dopo la mossa migliore: ' : 'After the best move: ') + bestReply);
  }
  if (!forced && losesChances) details.push(alternativeReason || reasoning?.prevention || (it ? 'Confronta le risposte alla tua mossa con quelle alla mossa suggerita.' : 'Compare the replies to your move with those after the suggested move.'));
  return {
    text,
    best: bestSummary ? `${it ? same ? 'Mossa migliore, anche giocata' : 'Mossa migliore' : same ? 'Best move, also played' : 'Best move'}: ${bestSummary}.${help ? ' ' + briefAlternativeHelp(help, options) : ''}` : it ? 'La mossa migliore non è ancora disponibile.' : 'The best move is not available yet.',
    detail: details.filter(Boolean).join(' '),
    threat,
    targets: reasoning?.targets || attacks.map(a => a.square),
    played,
    insight,
    hint: reasoning?.hint,
    alternativeHelp: help,
    alternativeReason,
  };
}
