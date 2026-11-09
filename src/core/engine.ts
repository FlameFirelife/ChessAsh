import { Chess } from 'chess.js';
import type { EngineLine, EngineResult, PositionOptions } from './types';

export const ENGINE_VERSION = 'Stockfish 19.0.1 Lite (single thread)';
const cache = new Map<string, EngineResult>();

export function abortError(): Error { return new DOMException('Analysis cancelled.', 'AbortError'); }

export function scoreFromUci(value: number, kind: string, turn: 'w' | 'b'): { score: number; mate?: number } {
  const sign = turn === 'w' ? 1 : -1;
  if (kind === 'mate') {
    const mate = value * sign;
    return { score: (value >= 0 ? 1 : -1) * sign * (30000 - Math.min(100, Math.abs(value)) * 100), mate };
  }
  return { score: value * sign };
}

export function parseInfo(line: string, turn: 'w' | 'b'): EngineLine | null {
  if (!line.startsWith('info ') || /\b(?:upperbound|lowerbound)\b/.test(line)) return null;
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1]);
  const match = line.match(/\bscore (cp|mate) (-?\d+)/);
  const pv = line.match(/\bpv (.+)$/)?.[1]?.trim().split(/\s+/);
  if (!depth || !match || !pv?.length) return null;
  const value = scoreFromUci(Number(match[2]), match[1], turn);
  return { rank: Number(line.match(/\bmultipv (\d+)/)?.[1] || 1), depth, ...value, pv };
}

class UciEngine {
  worker?: Worker;
  ready?: Promise<void>;
  listener?: (line: string) => void;
  rejectActive?: (error: Error) => void;
  queue: Promise<unknown> = Promise.resolve();

  initialize(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.reset(); reject(new Error('Stockfish did not start. Restart the app and try again.')); }, 30000);
      try {
        const worker = new Worker(new URL('engine/stockfish.js', document.baseURI));
        this.worker = worker;
        worker.onmessage = event => {
          const data = typeof event.data === 'string' ? event.data : '';
          for (const line of data.split(/\r?\n/)) {
            if (line === 'uciok') {
              worker.postMessage('setoption name Hash value 32');
              worker.postMessage('setoption name Threads value 1');
              worker.postMessage('isready');
            }
            if (line === 'readyok') { clearTimeout(timer); resolve(); }
            this.listener?.(line);
          }
        };
        worker.onerror = () => {
          clearTimeout(timer);
          const error = new Error('The local chess engine could not run. Check the engine assets or restart the app.');
          reject(error);
          this.rejectActive?.(error);
          this.reset();
        };
        worker.postMessage('uci');
      } catch (error) {
        clearTimeout(timer);
        this.reset();
        reject(error);
      }
    });
    return this.ready;
  }

  reset() {
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
    this.listener = undefined;
    this.rejectActive = undefined;
  }

  async search(fen: string, options: PositionOptions): Promise<EngineResult> {
    if (options.signal?.aborted) throw abortError();
    const chess = new Chess(fen);
    const legal = chess.moves();
    if (!legal.length || chess.isInsufficientMaterial() || chess.isDrawByFiftyMoves()) {
      const score = chess.isCheckmate() ? (chess.turn() === 'w' ? -30000 : 30000) : 0;
      return { fen, depth: options.depth || 12, score, mate: chess.isCheckmate() ? 0 : undefined, best: '', pv: [], lines: [] };
    }
    await this.initialize();
    if (options.signal?.aborted) throw abortError();
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      const lines = new Map<number, EngineLine>();
      let cancelled = false;
      let cancelTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        clearTimeout(timer);
        clearTimeout(cancelTimer);
        options.signal?.removeEventListener('abort', abort);
        this.listener = undefined;
        this.rejectActive = undefined;
      };
      const timer = setTimeout(() => {
        finish(); this.reset(); reject(new Error('The engine search timed out. Try a lower analysis depth.'));
      }, 120000);
      const abort = () => {
        cancelled = true;
        worker.postMessage('stop');
        cancelTimer = setTimeout(() => { finish(); this.reset(); reject(abortError()); }, 2500);
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      this.rejectActive = error => { finish(); reject(error); };
      this.listener = line => {
        const info = parseInfo(line, chess.turn());
        if (info) {
          const previous = lines.get(info.rank);
          if (!previous || info.depth >= previous.depth) lines.set(info.rank, info);
        }
        if (line.startsWith('bestmove ')) {
          finish();
          if (cancelled) { reject(abortError()); return; }
          const best = line.split(/\s+/)[1];
          const principal = lines.get(1);
          if (!principal) { reject(new Error('The engine returned no usable evaluation. Try again.')); return; }
          const pv = principal.pv[0] === best ? principal.pv : [best];
          resolve({ fen, depth: principal.depth, score: principal.score, mate: principal.mate, best, pv, lines: [...lines.values()].sort((a, b) => a.rank - b.rank) });
        }
      };
      worker.postMessage(`setoption name MultiPV value ${Math.max(1, Math.min(3, options.multiPv || 2))}`);
      worker.postMessage('position fen ' + fen);
      const moves = options.moves?.filter(move => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
      worker.postMessage(`go depth ${Math.max(4, Math.min(22, options.depth || 12))}${moves?.length ? ' searchmoves ' + moves.join(' ') : ''}`);
    });
  }

  analyze(fen: string, options: PositionOptions): Promise<EngineResult> {
    const key = JSON.stringify([fen, options.depth || 12, options.multiPv || 2, options.moves || []]);
    const found = cache.get(key);
    if (options.signal?.aborted) return Promise.reject(abortError());
    if (found) return Promise.resolve(found);
    const result = this.queue.then(() => this.search(fen, options));
    this.queue = result.catch(() => {});
    return result.then(value => {
      if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
      cache.set(key, value);
      return value;
    });
  }
}

const engine = new UciEngine();
export function analyzePosition(fen: string, options: PositionOptions = {}): Promise<EngineResult> {
  return engine.analyze(fen, options);
}
export function stopEngine(): void {
  engine.rejectActive?.(abortError());
  engine.reset();
}
export function resetEngineAnalysis(): void {
  stopEngine();
  cache.clear();
}
