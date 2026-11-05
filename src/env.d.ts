import type { PolicyResult, ReviewFacts } from "./core";
declare global {
  interface Window {
    chessash?: {
      platform: string;
      reviewFacts(facts: ReviewFacts[]): Promise<PolicyResult[]>;
      apiFetch(url: string): Promise<unknown>;
      [key: string]: unknown;
    };
  }
}
