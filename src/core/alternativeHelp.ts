import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import { legalDefenders, legalAttackTargets, squaresBetween } from './moveInsight';
import type { InsightPiece, MoveInsight } from './moveInsight';

export type AlternativeHelp = {
  kind: 'mate' | 'stalemate' | 'removes-attacker' | 'preserves-defense' | 'escapes-capture' | 'keeps-line-closed' | 'avoids-fork' | 'avoids-pin' | 'answers-check' | 'gives-check' | 'unrecaptured-capture';
  move: Move;
  piece: InsightPiece;
  related?: InsightPiece;
  replySAN?: string;
};
const play = (board: Chess, uci: string) => {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Invalid move');
  return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
};
const piece = (board: Chess, square: Square): InsightPiece | undefined => {
  const p = board.get(square); return p ? { ...p, square } : undefined;
};
const captureSquare = (move: Move): Square => move.isEnPassant() ? `${move.to[0]}${move.from[1]}` as Square : move.to;
function pinned(board: Chess, target: InsightPiece) {
  const king = board.board().flat().find(p => p?.type === 'k' && p.color === target.color);
  if (!king) return false;
  return board.board().flat().some(attacker => {
    if (!attacker || attacker.color === target.color || !['b', 'r', 'q'].includes(attacker.type)) return false;
    const dx = Math.abs(attacker.square.charCodeAt(0) - king.square.charCodeAt(0)), dy = Math.abs(Number(attacker.square[1]) - Number(king.square[1]));
    if (!(dx === 0 || dy === 0 || dx === dy) || (attacker.type === 'b' && dx !== dy) || (attacker.type === 'r' && dx && dy)) return false;
    const blockers = squaresBetween(attacker.square, king.square).filter(s => board.get(s));
    return blockers.length === 1 && blockers[0] === target.square;
  });
}

export function alternativeHelp(beforeFen: string, played: string, best: string, insight?: MoveInsight): AlternativeHelp | undefined {
  if (!best || best === played) return;
  try {
    const before = new Chess(beforeFen), actual = new Chess(beforeFen), alternative = new Chess(beforeFen);
    if (insight && (insight.moved.before !== before.fen() || insight.moved.lan !== played)) insight = undefined;
    const badMove = play(actual, played), move = play(alternative, best);
    const enemyKing = before.board().flat().find(p => p?.type === 'k' && p.color !== move.color);
    if (!enemyKing || before.isAttacked(enemyKing.square, move.color)) return;
    const moving = piece(alternative, move.to)!;
    const result = (kind: AlternativeHelp['kind'], target = moving, related?: InsightPiece, replySAN?: string): AlternativeHelp => ({ kind, move, piece: target, related, replySAN });
    if (alternative.isCheckmate()) return result('mate');
    if (alternative.isStalemate()) return result('stalemate');
    const capturedAt = captureSquare(move), taken = move.captured ? piece(before, capturedAt) : undefined;
    const immediate = insight?.ply === 1 ? insight : undefined;
    const attacker = immediate ? piece(before, immediate.reply.from) : undefined;
    if (taken && attacker && capturedAt === attacker.square && taken.type === immediate!.reply.piece && taken.color === immediate!.reply.color) return result('removes-attacker', taken);
    if (insight?.kind === 'abandoned-defender') {
      const target = piece(alternative, insight.targets[0].square);
      if (target?.color === move.color && target.type === insight.targets[0].type && !legalDefenders(actual.fen(), target.square).length && legalDefenders(alternative.fen(), target.square).length) return result('preserves-defense', target);
    }
    if (immediate?.kind === 'opened-line' && attacker) {
      const blocker = piece(alternative, badMove.from), target = piece(alternative, immediate.targets[0].square);
      const original = piece(before, badMove.from);
      const origin = immediate.targets[0].type === 'k' ? immediate.reply.to : immediate.reply.from;
      if (blocker && original && blocker.color === move.color && blocker.type === original.type && target?.color === move.color && target.type === immediate.targets[0].type && squaresBetween(origin, target.square).includes(blocker.square)) return result('keeps-line-closed', blocker, target);
    }
    if (immediate && ['loose-piece', 'abandoned-defender', 'opened-line', 'fork', 'pin'].includes(immediate.kind)) {
      const target = immediate.targets.find(t => t.square === move.from && t.color === move.color && before.get(t.square)?.type === t.type);
      if (target && target.type !== 'k' && ['loose-piece', 'abandoned-defender', 'opened-line'].includes(immediate.kind) && !alternative.moves({ verbose: true }).some(m => m.captured && captureSquare(m) === move.to)) return result('escapes-capture', moving, target);
      const replay = new Chess(alternative.fen());
      let reply: Move | undefined;
      try { reply = play(replay, immediate.reply.lan); } catch {}
      if (reply && target && immediate.kind === 'fork' && legalAttackTargets(replay, reply).length < 2 && !replay.attackers(move.to, reply.color).includes(reply.to)) return result('avoids-fork', moving, target, reply.san);
      if (reply && immediate.kind === 'pin') {
        const target = piece(replay, immediate.targets[0].square);
        const king = alternative.board().flat().find(p => p?.type === 'k' && p.color === move.color)!;
        if (target?.color === move.color && target.type === immediate.targets[0].type && move.piece === 'k' && !pinned(replay, target)) return result('avoids-pin', king, target, reply.san);
      }
    }
    if (before.isCheck()) {
      const king = before.board().flat().find(p => p?.type === 'k' && p.color === move.color)!;
      const checkers = before.attackers(king.square, move.color === 'w' ? 'b' : 'w');
      if (taken && checkers.includes(capturedAt)) return result('removes-attacker', taken);
      const checker = checkers.length === 1 ? piece(before, checkers[0]) : undefined;
      if (checker && move.piece !== 'k' && ['b', 'r', 'q'].includes(checker.type) && squaresBetween(checker.square, king.square).includes(move.to)) return result('answers-check', moving, checker);
    }
    if (alternative.isCheck()) return result('gives-check');
    if (taken && !legalDefenders(beforeFen, capturedAt).length && !alternative.moves({ verbose: true }).some(m => m.captured && captureSquare(m) === move.to)) return result('unrecaptured-capture', taken);
  } catch { return; }
}
