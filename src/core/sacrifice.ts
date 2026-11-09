import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import type { EngineResult, PositionOptions } from './types';

const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const play = (board: Chess, uci: string) => board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
export type SacrificeOffer = { capture: string; square: string; investment: number };
export type SacrificeEvidence = SacrificeOffer & { outcome: 'stalemate' | 'draw' | 'compensation'; score: number };

function exchangeGain(fen: string, capture: Move, budget: { left: number }, depth = 0): number {
  if (--budget.left < 0 || depth > 10) throw new Error('Exchange window exceeded');
  const board = new Chess(fen); play(board, capture.lan);
  const gain = value[capture.captured || 'k'] + (capture.promotion ? value[capture.promotion] - 1 : 0);
  const replies = board.moves({ verbose: true }).filter(move => move.captured && move.to === capture.to);
  return gain - Math.max(0, ...replies.map(move => exchangeGain(board.fen(), move, budget, depth + 1)));
}

export function sacrificeOffers(beforeFen: string, uci: string): SacrificeOffer[] {
  try {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return [];
    const before = new Chess(beforeFen), after = new Chess(beforeFen);
    if (before.moves().length < 2) return [];
    const moved = play(after, uci);
    if (after.isGameOver()) return [];
    const priorFields = before.fen().split(' '); priorFields[1] = after.turn(); priorFields[3] = '-';
    const priorCaptures = new Chess(priorFields.join(' ')).moves({ verbose: true });
    const gained = value[moved.captured || 'k'] + (moved.promotion ? value[moved.promotion] - 1 : 0);
    return after.moves({ verbose: true }).flatMap(capture => {
      if (!capture.captured || value[capture.captured] < 3) return [];
      try {
        const prior = priorCaptures.find(prior => prior.lan === capture.lan);
        if (capture.to !== moved.to && prior && exchangeGain(priorFields.join(' '), prior, { left: 256 }) >= 2) return [];
        const investment = exchangeGain(after.fen(), capture, { left: 256 }) - gained;
        return investment >= 2 ? [{ capture: capture.lan, square: capture.to, investment }] : [];
      } catch { return []; }
    }).sort((a, b) => b.investment - a.investment);
  } catch { return []; }
}

export async function verifySacrifice(fen: string, offers: SacrificeOffer[], after: EngineResult, analyze: (fen: string, options: PositionOptions) => Promise<EngineResult>, signal?: AbortSignal): Promise<SacrificeEvidence | undefined> {
  const side = new Chess(fen).turn() === 'w' ? -1 : 1;
  if (after.depth < 14 || after.score * side < -50) return;
  for (const offer of offers.slice(0, 3)) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    const accepted = new Chess(fen); play(accepted, offer.capture);
    if (accepted.isCheckmate()) continue;
    if (accepted.isStalemate() || accepted.isInsufficientMaterial()) return { ...offer, outcome: accepted.isStalemate() ? 'stalemate' : 'draw', score: 0 };
    const proof = await analyze(fen, { depth: 14, multiPv: 1, moves: [offer.capture], signal });
    if (proof.depth < 14 || proof.pv[0] !== offer.capture || proof.score * side < -50) continue;
    try {
      const line = new Chess(fen); for (const move of proof.pv.slice(0, 8)) play(line, move);
      return { ...offer, outcome: 'compensation', score: proof.score };
    } catch {}
  }
}
