import type { Game } from '../core/types';
import { associateGames, normaliseUsername, validUsername } from './model';

export const SYNC_INTERVAL = 120_000;
export interface SyncSnapshot { syncing: boolean; lastSynced: number; lastAttempt: number; nextCheck: number; failures: number; error: string; }
type Dependencies = {
  fetchGames: (username: string, progress?: (message: string) => void, months?: number) => Promise<Game[]>;
  commit: (games: Game[]) => void;
  onState: (username: string, state: SyncSnapshot) => void;
  now?: () => number;
  hydrate?: (username: string) => number;
};
export class AccountSyncCoordinator {
  private states = new Map<string, SyncSnapshot>();
  private pending = new Map<string, Promise<Game[]>>();
  private now: () => number;
  constructor(private dependencies: Dependencies) { this.now = dependencies.now || Date.now; }
  snapshot(username: string): SyncSnapshot {
    const name = normaliseUsername(username);
    if (!this.states.has(name)) {
      const lastSynced = this.dependencies.hydrate?.(name) || 0;
      this.states.set(name, { syncing: false, lastSynced, lastAttempt: 0, nextCheck: lastSynced ? lastSynced + SYNC_INTERVAL : 0, failures: 0, error: '' });
    }
    return { ...this.states.get(name)! };
  }
  private update(name: string, patch: Partial<SyncSnapshot>) {
    const state = { ...this.snapshot(name), ...patch };
    this.states.set(name, state);
    this.dependencies.onState(name, { ...state });
  }
  sync(username: string, options: { manual?: boolean; eligible?: boolean } = {}): Promise<Game[]> {
    const name = normaliseUsername(username);
    if (!validUsername(name)) return Promise.reject(new Error('Choose your main Chess.com username first.'));
    const state = this.snapshot(name);
    if (options.eligible === false) return Promise.resolve([]);
    if (this.pending.has(name)) return this.pending.get(name)!;
    if (!options.manual && this.now() < state.nextCheck) return Promise.resolve([]);
    this.update(name, { syncing: true, lastAttempt: this.now(), error: '' });
    const request = Promise.resolve().then(() => this.dependencies.fetchGames(name, undefined, 1)).then(games => {
      const tagged = associateGames(games, name);
      this.dependencies.commit(tagged);
      this.update(name, { syncing: false, lastSynced: this.now(), failures: 0, nextCheck: this.now() + SYNC_INTERVAL, error: '' });
      return tagged;
    }).catch(error => {
      const failures = state.failures + 1;
      this.update(name, { syncing: false, failures, nextCheck: this.now() + Math.min(1_800_000, SYNC_INTERVAL * 2 ** Math.min(failures - 1, 4)), error: error instanceof Error ? error.message : 'Could not check for new games.' });
      throw error;
    }).finally(() => this.pending.delete(name));
    this.pending.set(name, request);
    return request;
  }
}
