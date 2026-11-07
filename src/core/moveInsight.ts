import { Chess } from 'chess.js';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';

export type InsightPiece = { square: Square; type: PieceSymbol; color: Color };
export type MoveInsight = {
  kind: 'abandoned-defender' | 'opened-line' | 'fork' | 'pin' | 'back-rank' | 'loose-piece' | 'mate-line';
  moved: Move; reply: Move; targets: InsightPiece[]; line: string[]; uci: string[]; ply: number;
  preservesDefense: boolean;
};
const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const play = (board: Chess, uci: string) => {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Invalid move');
  return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
};
export function squaresBetween(from: Square, to: Square): Square[] {
  const dx = to.charCodeAt(0) - from.charCodeAt(0), dy = Number(to[1]) - Number(from[1]);
  if ((!dx && !dy) || (dx && dy && Math.abs(dx) !== Math.abs(dy))) return [];
  const count = Math.max(Math.abs(dx), Math.abs(dy));
  return Array.from({ length: count - 1 }, (_, i) => `${String.fromCharCode(from.charCodeAt(0) + Math.sign(dx) * (i + 1))}${Number(from[1]) + Math.sign(dy) * (i + 1)}` as Square);
}
export function legalDefenders(fen: string, square: Square): Square[] {
  const board = new Chess(fen), target = board.get(square);
  if (!target || target.type === 'k') return [];
  const attackers = board.attackers(square, target.color);
  return attackers.filter(from => {
    try {
      const fields = fen.split(' '); fields[1] = target.color; fields[3] = '-';
      const test = new Chess(fields.join(' '));
      test.remove(square); test.put({ type: 'n', color: target.color === 'w' ? 'b' : 'w' }, square);
      return test.moves({ square: from, verbose: true }).some(move => move.to === square);
    } catch { return false; }
  });
}
export function legalAttackTargets(board: Chess, move: Move): InsightPiece[] {
  const fields = board.fen().split(' '); fields[1] = move.color; fields[3] = '-';
  const captures = new Chess(fields.join(' ')).moves({ square: move.to, verbose: true });
  return board.board().flat().filter(p => p && p.color !== move.color && p.type !== 'p' &&
    board.attackers(p.square, move.color).includes(move.to) && (p.type === 'k' ? board.isCheck() : captures.some(m => m.to === p.square))) as InsightPiece[];
}

export function findMoveInsights(beforeFen: string, played: string, pv: string[], best?: string): MoveInsight[] {
  try {
    const before = new Chess(beforeFen), after = new Chess(beforeFen), moved = play(after, played);
    const opposingKing = before.board().flat().find(p => p?.type === 'k' && p.color !== moved.color);
    if (!opposingKing || before.isAttacked(opposingKing.square, moved.color)) return [];
    const afterFen = after.fen(), board = new Chess(afterFen);
    const steps: { before: string; after: string; move: Move }[] = [];
    for (const uci of pv.slice(0, 8)) {
      const from = board.fen(), move = play(board, uci);
      steps.push({ before: from, after: board.fen(), move });
    }
    if (!steps.length) return [];
    const line = steps.map(s => s.move.san), uci = steps.map(s => s.move.lan);
    const insights: MoveInsight[] = [];
    const add = (kind: MoveInsight['kind'], index: number, targets: InsightPiece[]) => {
      let preservesDefense = false;
      if (best && best !== played && targets.length === 1 && kind === 'abandoned-defender') {
        try {
          const alternative = new Chess(beforeFen); play(alternative, best);
          const target = alternative.get(targets[0].square);
          preservesDefense = target?.type === targets[0].type && target.color === moved.color && legalDefenders(alternative.fen(), targets[0].square).length > 0;
        } catch {}
      }
      insights.push({ kind, moved, reply: steps[index].move, targets, line, uci, ply: index + 1, preservesDefense });
    };
    for (const [index, step] of steps.entries()) {
      const move = step.move;
      if (move.color === moved.color) continue;
      const current = new Chess(step.after), prior = new Chess(step.before);
      const king = current.board().flat().find(p => p?.type === 'k' && p.color === moved.color)!;
      const captured = move.captured && !move.isEnPassant() ? prior.get(move.to) : undefined;
      const directTarget = captured ? { ...captured, square: move.to } : undefined;
      const directCheck = current.isCheck() && current.attackers(king.square, move.color).includes(move.to);
      const rayTarget = directCheck ? king : directTarget;
      if (rayTarget && ['b', 'r', 'q'].includes(move.piece) && !(directCheck && moved.piece === 'k')) {
        const ray = squaresBetween(directCheck ? move.to : move.from, rayTarget.square);
        if (ray.includes(moved.from) && ray.every(s => !after.get(s)) && before.get(moved.from)?.color === moved.color) {
          add('opened-line', index, [rayTarget]);
        }
      }
      if (move.captured && !move.isEnPassant() && move.captured !== 'p') {
        const original = before.get(move.to), post = after.get(move.to);
        const unchanged = steps.slice(0, index).every(s => s.move.from !== move.to && s.move.to !== move.to);
        if (original?.color === moved.color && post?.type === original.type && unchanged) {
          const guards = legalDefenders(beforeFen, move.to);
          if (guards.length === 1 && guards[0] === moved.from && !legalDefenders(afterFen, move.to).length) add('abandoned-defender', index, [{ ...original, square: move.to }]);
        }
        if (index === 0 && directTarget && !legalDefenders(step.before, move.to).length && !insights.some(i => i.kind === 'abandoned-defender')) add('loose-piece', index, [directTarget]);
      }
      if (['n', 'p'].includes(move.piece)) {
        const targets = legalAttackTargets(current, move).sort((a, b) => value[b.type] - value[a.type]);
        if (targets.length >= 2) add('fork', index, targets.slice(0, 2));
      }
      if (['b', 'r', 'q'].includes(move.piece)) {
        const ray = squaresBetween(move.to, king.square);
        const diagonal = move.to[0] !== king.square[0] && move.to[1] !== king.square[1];
        const aligned = move.to[0] === king.square[0] || move.to[1] === king.square[1] || Math.abs(move.to.charCodeAt(0) - king.square.charCodeAt(0)) === Math.abs(Number(move.to[1]) - Number(king.square[1]));
        const blockers = ray.flatMap(square => { const p = current.get(square); return p ? [{ ...p, square }] : []; });
        if (aligned && (move.piece === 'q' || move.piece === (diagonal ? 'b' : 'r')) && blockers.length === 1 && blockers[0]!.color === moved.color && blockers[0]!.type !== 'k') add('pin', index, [blockers[0]!, king]);
      }
      if (current.isCheckmate()) {
        const rank = moved.color === 'w' ? '1' : '8', shield = moved.color === 'w' ? '2' : '7';
        const pawns = [-1, 0, 1].filter(offset => {
          const file = king.square.charCodeAt(0) + offset;
          if (file < 97 || file > 104) return false;
          const pawn = current.get(`${String.fromCharCode(file)}${shield}` as Square);
          return pawn?.color === moved.color && pawn.type === 'p';
        }).length;
        add(['r', 'q'].includes(move.piece) && king.square[1] === rank && move.to[1] === rank && pawns >= 2 ? 'back-rank' : 'mate-line', index, [king]);
      }
    }
    const priority = { 'abandoned-defender': 0, 'opened-line': 1, 'back-rank': 2, fork: 3, pin: 4, 'loose-piece': 5, 'mate-line': 6 };
    return insights.sort((a, b) => priority[a.kind] - priority[b.kind] || a.ply - b.ply).filter((i, index, all) => all.findIndex(other => other.kind === i.kind) === index).slice(0, 3);
  } catch { return []; }
}
