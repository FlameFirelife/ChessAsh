import type { Label, MoveReview, ReviewFacts } from './types';

export const LABELS: Label[] = ['sacrifice', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
export const LABEL_INFO: Record<Label, { name: string; symbol: string; description: string }> = {
  book: { name: 'Opening', symbol: 'B', description: 'A recognised opening sequence.' },
  best: { name: 'Best', symbol: '★', description: 'The engine’s preferred move at this search depth.' },
  excellent: { name: 'Excellent', symbol: '✓', description: 'Very close to the engine’s preferred move.' },
  good: { name: 'Good', symbol: '+', description: 'Keeps most of the position’s chances.' },
  inaccuracy: { name: 'Inaccuracy', symbol: '?!', description: 'Concedes some of the position’s chances.' },
  mistake: { name: 'Mistake', symbol: '?', description: 'Gives away a substantial opportunity.' },
  blunder: { name: 'Blunder', symbol: '??', description: 'A large, avoidable deterioration.' },
  miss: { name: 'Missed chance', symbol: '×', description: 'Misses a concrete advantage from a promising position.' },
  great: { name: 'Critical find', symbol: '!', description: 'Finds the only clearly strong candidate in this search.' },
  sacrifice: { name: 'Sound sacrifice', symbol: '!!', description: 'An engine-checked material investment with compensation.' },
};

export const POLICY_VERSION = 2;

export function classify(facts: ReviewFacts): Label {
  if (facts.book) return 'book';
  if (facts.verified && facts.sacrifice && facts.loss <= 15) return 'sacrifice';
  if (facts.verified && facts.critical && facts.playedBest && facts.loss <= 15) return 'great';
  if (facts.loss >= 250) return 'blunder';
  if (facts.missedChance && facts.loss >= 100) return 'miss';
  if (facts.loss >= 100) return 'mistake';
  if (facts.loss >= 45) return 'inaccuracy';
  if (facts.playedBest) return 'best';
  if (facts.loss <= 15) return 'excellent';
  return 'good';
}

export function accuracy(results: MoveReview[], color?: 'w' | 'b'): number {
  const relevant = results.filter(result => !color || result.color === color);
  if (!relevant.length) return 0;
  const scores = relevant.map(result => 100 * Math.exp(-Math.min(1500, Math.max(0, result.loss)) / 300));
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export function winChance(cp: number): number {
  return 100 / (1 + Math.exp(-Math.max(-2000, Math.min(2000, cp)) / 350));
}

export function phaseAt(gameMoves: string[], ply: number, fen: string): 'Opening' | 'Middlegame' | 'Endgame' {
  const board = fen.split(' ')[0];
  const majors = (board.match(/[QRqr]/g) || []).length;
  const minors = (board.match(/[BNbn]/g) || []).length;
  if (majors <= 2 && minors <= 4) return 'Endgame';
  if (ply <= Math.min(20, gameMoves.length) && majors >= 4) return 'Opening';
  return 'Middlegame';
}
