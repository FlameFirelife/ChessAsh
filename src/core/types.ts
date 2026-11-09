export type Label = 'book' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'miss' | 'great' | 'sacrifice';
export interface MoveReview {
  ply: number;
  move: string;
  san?: string;
  color: 'w' | 'b';
  before: number;
  after: number;
  loss: number;
  label: Label;
  best: string;
  pv: string[];
  depth: number;
  explanation: string;
  hints: string[];
  key: boolean;
  facts?: ReviewFacts;
  mate?: number;
  consequenceOf?: number;
  replyPv?: string[];
  sacrificeEvidence?: import('./sacrifice').SacrificeEvidence;
}
export interface Review {
  version: number;
  engine: string;
  depth: number;
  results: MoveReview[];
  completed: boolean;
  createdAt?: number;
}
export interface Game {
  reviewAs?: 'w' | 'b' | 'neutral';
  id: string;
  pgn: string;
  headers: Record<string, string>;
  moves: string[];
  positions: string[];
  source: string;
  url?: string;
  review?: Review;
  notes?: Record<number, string>;
  lastPly?: number;
  importedAt?: number;
  timeClass?: string;
  accountUsernames?: string[];
}
export interface EngineLine {
  rank: number;
  depth: number;
  score: number;
  mate?: number;
  pv: string[];
}
export interface EngineResult {
  fen: string;
  depth: number;
  score: number;
  mate?: number;
  best: string;
  pv: string[];
  lines: EngineLine[];
}
export interface ReviewFacts {
  loss: number;
  playedBest: boolean;
  book: boolean;
  missedChance: boolean;
  critical: boolean;
  sacrifice: boolean;
  verified: boolean;
}
export interface PolicyResult {
  label: Label;
  key: boolean;
  template?: string;
  hint?: string;
}
export interface AnalyzeOptions {
  fresh?: boolean;
  depth?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  onResult?: (result: MoveReview) => void;
  existing?: Review;
  classify?: (facts: ReviewFacts) => Promise<Label | PolicyResult> | Label | PolicyResult;
}
export interface PositionOptions {
  depth?: number;
  signal?: AbortSignal;
  moves?: string[];
  multiPv?: number;
}
