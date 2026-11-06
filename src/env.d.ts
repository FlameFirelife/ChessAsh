import type { PolicyResult, ReviewFacts } from "./core";
declare global {
  interface Window {
    chessash?: {
      platform: string;
      reviewFacts(facts: ReviewFacts[]): Promise<PolicyResult[]>;
      trainingDecisions(facts: import('./core/trainingPolicy').TrainingPolicyFact[]): Promise<import('./core/trainingPolicy').TrainingDecision[]>;
      apiFetch(url: string): Promise<unknown>;
      [key: string]: unknown;
    };
  }
}
