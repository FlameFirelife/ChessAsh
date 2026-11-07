import { Chess } from 'chess.js';
import { analyzePosition, ENGINE_VERSION } from './engine';
import { classify, POLICY_VERSION, LABEL_INFO } from './policy';
import { isBookMove } from './openings';
import { playUci } from './pgn';
import { reviewCoaching } from './coaching';
import type { AnalyzeOptions, EngineResult, MoveReview, Review, ReviewFacts } from './types';
import type { Game } from './types';

const MATERIAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function material(fen: string, color: 'w' | 'b'): number {
  return new Chess(fen).board().flat().reduce((sum, piece) => !piece ? sum : sum + MATERIAL[piece.type] * (piece.color === color ? 1 : -1), 0);
}

function soundSacrifice(beforeFen: string, played: string, after: EngineResult, color: 'w' | 'b'): boolean {
  if (after.depth < 14 || after.pv.length < 4 || after.score * (color === 'w' ? 1 : -1) < -50) return false;
  const chess = new Chess(beforeFen);
  const mover = chess.get(played.slice(0, 2) as Parameters<Chess['get']>[0]);
  if (!mover || MATERIAL[mover.type] < 3) return false;
  const baseline = material(beforeFen, color);
  const result = playUci(beforeFen, played);
  if (!result) return false;
  try {
    const replyBoard = new Chess(result.fen);
    const reply = after.pv[0];
    const capture = replyBoard.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
    if (capture.to !== played.slice(2, 4) || !capture.captured || MATERIAL[capture.captured] < 3) return false;
  } catch { return false; }
  let fen = result.fen;
  for (const move of after.pv.slice(0, 4)) {
    const next = playUci(fen, move);
    if (!next) return false;
    fen = next.fen;
  }
  return material(fen, color) <= baseline - 2;
}

export function factsForMove(game: Game, ply: number, before: EngineResult, after: EngineResult): ReviewFacts {
  const board = new Chess(game.positions[ply - 1]);
  const forced = board.moves().length === 1;
  const move = board.move(game.moves[ply - 1]);
  const side = move.color === 'w' ? 1 : -1;
  const playedBest = forced || move.lan === before.best;
  const matePreserved = before.mate !== undefined && after.mate !== undefined && Math.sign(before.score) === Math.sign(after.score);
  const loss = playedBest || matePreserved ? 0 : Math.max(0, Math.round((before.score - after.score) * side));
  const second = before.lines.find(line => line.rank === 2 && line.depth >= Math.min(before.depth, 14));
  const gap = second ? (before.score - second.score) * side : 0;
  return {
    loss, playedBest, book: game.positions[0] === new Chess().fen() && isBookMove(game.moves, ply),
    missedChance: before.score * side >= 150 && after.score * side < 75,
    critical: !!second && gap >= 150 && before.score * side >= -100 && before.score * side <= 1000,
    sacrifice: playedBest && soundSacrifice(game.positions[ply - 1], move.lan, after, move.color),
    verified: Math.min(before.depth, after.depth) >= 14,
  };
}

export function continuationEvidence(fen: string, color: 'w' | 'b', moves: string[]): string {
  const board = new Chess(fen);
  const baseline = material(fen, color);
  const continuation: string[] = [];
  let capture = '';
  for (const [index, uci] of moves.slice(0, 8).entries()) {
    try {
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      continuation.push(move.san);
      if (index === 0 && move.color !== color && move.captured) {
        capture = `The reply ${move.san} captures your ${pieceName(move.captured)}${move.flags.includes('e') ? ' en passant' : ' on ' + move.to}. `;
      }
    } catch { break; }
  }
  if (!continuation.length) return '';
  const line = continuation.join(' ');
  if (board.isCheckmate()) return `${capture}The legal continuation ${line} ends in checkmate.`;
  const change = material(board.fen(), color) - baseline;
  if (change <= -1) return `${capture}In the line ${line}, your material balance falls by ${Math.abs(change)} point${change === -1 ? '' : 's'} (pawn = 1, minor piece = 3, rook = 5, queen = 9).`;
  return capture ? `${capture}Explore ${line} to compare the replies.` : `The engine continuation is ${line}.`;
}

function explanationFor(game: Game, result: MoveReview, after: EngineResult, policyHint?: string): { explanation: string; hints: string[] } {
  const coaching = reviewCoaching(game, { ...result, replyPv: after.pv });
  return {
    explanation: [coaching.text, coaching.detail, coaching.best].filter(Boolean).join(' '),
    hints: [
      coaching.hint || policyHint || 'Look for checks, captures and threats before choosing a move.',
      result.best ? `Consider the piece on ${result.best.slice(0, 2)}.` : 'Inspect all legal replies.',
      coaching.best,
    ],
  };
}

function pieceName(piece: string) { return ({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' } as Record<string, string>)[piece] || 'piece'; }

export function groupForcedConsequence(game: Game, result: MoveReview, previous: MoveReview[]): MoveReview {
  if (new Chess(game.positions[result.ply - 1]).moves().length !== 1) return result;
  const side = result.color === 'w' ? 1 : -1;
  const cause = [...previous].reverse().find(item => item.color === result.color && item.key && item.before * side > -29000 && item.after * side <= -29000);
  if (cause && previous.filter(item => item.ply >= cause.ply).every(item => item.after * side <= -29000)) {
    return { ...result, key: false, consequenceOf: cause.ply, explanation: `This is the only legal move. It continues the forced-mate line introduced at move ${Math.ceil(cause.ply / 2)}${cause.color === 'w' ? '.' : '…'} ${cause.san || game.moves[cause.ply - 1]}; it is not another avoidable mistake. ${result.explanation}` };
  }
  return { ...result, explanation: `This is the only legal move in the position. ${result.explanation}` };
}

export async function analyzeGame(game: Game, options: AnalyzeOptions = {}): Promise<Review> {
  const depth = Math.max(4, Math.min(22, options.depth || 12));
  const previous = options.existing || game.review;
  const resumable = previous?.version === POLICY_VERSION && previous.depth === depth && previous.engine === ENGINE_VERSION;
  const results = resumable ? [...previous.results].sort((a, b) => a.ply - b.ply) : [];
  let start = 0;
  while (results[start]?.ply === start + 1) start++;
  results.splice(start);
  const review: Review = { version: POLICY_VERSION, engine: ENGINE_VERSION, depth, results, completed: false, createdAt: Date.now() };
  for (let index = 0; index < results.length; index++) {
    if (options.signal?.aborted) return review;
    const previousResult = results[index];
    if (!previousResult.facts) continue;
    const decision = options.classify ? await options.classify(previousResult.facts) : classify(previousResult.facts);
    const label = typeof decision === 'string' ? decision : decision.label;
    if (!(label in LABEL_INFO)) throw new Error('The review policy returned an unknown move label.');
    const result = { ...previousResult, label, key: typeof decision === 'string' ? ['sacrifice', 'great', 'inaccuracy', 'mistake', 'blunder', 'miss'].includes(label) : decision.key };
    const next = results[index + 1];
    Object.assign(result, explanationFor(game, result, {
      fen: game.positions[result.ply], score: result.after, depth: result.depth, mate: result.mate,
      best: previousResult.replyPv?.[0] || next?.best || '', pv: previousResult.replyPv || next?.pv || [], lines: [],
    }, typeof decision !== 'string' ? decision.hint : undefined));
    const grouped = groupForcedConsequence(game, result, results.slice(0, index));
    results[index] = grouped;
    options.onResult?.(grouped);
  }
  options.onProgress?.(start, game.moves.length);
  if (start === game.moves.length) { review.completed = true; return review; }
  try {
    let workingDepth = Math.max(depth, results.at(-1)?.depth || depth);
    let before = await analyzePosition(game.positions[start], { depth: workingDepth, signal: options.signal });
    for (let index = start; index < game.moves.length; index++) {
      if (options.signal?.aborted) break;
      let after = await analyzePosition(game.positions[index + 1], { depth: workingDepth, signal: options.signal });
      const side = new Chess(game.positions[index]).turn() === 'w' ? 1 : -1;
      const rawLoss = (before.score - after.score) * side;
      const volatileMate = (before.mate === undefined) !== (after.mate === undefined);
      if (workingDepth < 14 && (rawLoss >= 100 || volatileMate)) {
        workingDepth = 14;
        before = await analyzePosition(game.positions[index], { depth: workingDepth, signal: options.signal });
        after = await analyzePosition(game.positions[index + 1], { depth: workingDepth, signal: options.signal });
      }
      const facts = factsForMove(game, index + 1, before, after);
      const decision = options.classify ? await options.classify(facts) : classify(facts);
      const label = typeof decision === 'string' ? decision : decision.label;
      if (!(label in LABEL_INFO)) throw new Error('The review policy returned an unknown move label.');
      const board = new Chess(game.positions[index]);
      const played = board.move(game.moves[index]);
      const result: MoveReview = {
        ply: index + 1, move: played.lan, san: played.san, color: played.color,
        before: before.score, after: after.score, loss: facts.loss, label,
        best: before.best, pv: before.pv, depth: Math.min(before.depth, after.depth),
        explanation: '', hints: [], key: typeof decision === 'string' ? ['sacrifice', 'great', 'inaccuracy', 'mistake', 'blunder', 'miss'].includes(label) : decision.key,
        facts, mate: after.mate, replyPv: after.pv,
      };
      Object.assign(result, explanationFor(game, result, after, typeof decision !== 'string' ? decision.hint : undefined));
      const grouped = groupForcedConsequence(game, result, results);
      results.push(grouped);
      options.onResult?.(grouped);
      options.onProgress?.(results.length, game.moves.length);
      before = after;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  }
  review.completed = results.length === game.moves.length;
  return review;
}
