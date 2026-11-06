import { Chess } from 'chess.js';
import type { Move } from 'chess.js';

export type PieceView = { id: number; sq: string; type: string; color: string };
export type BoardMotion = {
  fen: string;
  views: PieceView[];
  captured: PieceView[];
  moving: number[];
  next: number;
  history: Record<string, PieceView[]>;
};

const positionKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

function findTransition(from: string, to: string): Move | undefined {
  const board = new Chess(from);
  for (const move of board.moves({ verbose: true })) {
    board.move(move);
    const matches = positionKey(board.fen()) === positionKey(to);
    board.undo();
    if (matches) return move;
  }
}

export function initialBoardMotion(fen: string): BoardMotion {
  const views = new Chess(fen).board().flat().filter(p => p !== null).map((p, id) => ({ id, sq: p.square, type: p.type, color: p.color }));
  return { fen, views, captured: [], moving: [], next: views.length, history: { [fen]: views } };
}

export function nextBoardMotion(previous: BoardMotion, fen: string): BoardMotion {
  if (previous.fen === fen) return previous;
  const forward = findTransition(previous.fen, fen);
  const backward = !forward && findTransition(fen, previous.fen);
  let nextId = previous.next;
  const known = previous.history[fen];
  const used = new Set<number>();
  const board = new Chess(fen);
  const destinations = new Map<string, string>();
  const transition = forward || backward;
  if (transition) {
    destinations.set(forward ? transition.to : transition.from, forward ? transition.from : transition.to);
    if (transition.isKingsideCastle() || transition.isQueensideCastle()) {
      const rank = transition.from[1];
      const rookFrom = `${transition.isKingsideCastle() ? 'h' : 'a'}${rank}`;
      const rookTo = `${transition.isKingsideCastle() ? 'f' : 'd'}${rank}`;
      destinations.set(forward ? rookTo : rookFrom, forward ? rookFrom : rookTo);
    }
  }
  const views = known || board.board().flat().filter(p => p !== null).map(p => {
    const origin = destinations.get(p.square);
    let match = previous.views.find(v => !used.has(v.id) && v.color === p.color && (origin ? v.sq === origin : v.sq === p.square && v.type === p.type));
    if (!match && !transition) {
      const distance = (square: string) => Math.abs(square.charCodeAt(0) - p.square.charCodeAt(0)) + Math.abs(Number(square[1]) - Number(p.square[1]));
      match = previous.views.filter(v => !used.has(v.id) && v.color === p.color && v.type === p.type && !board.get(v.sq as Parameters<Chess['get']>[0])).sort((a, b) => distance(a.sq) - distance(b.sq))[0];
    }
    const id = match?.id ?? nextId++;
    used.add(id);
    return { id, sq: p.square, type: p.type, color: p.color };
  });
  const ids = new Set(views.map(p => p.id));
  const captured = forward ? previous.views.filter(p => !ids.has(p.id)) : [];
  const moving = views.filter(p => previous.views.some(old => old.id === p.id && old.sq !== p.sq)).map(p => p.id);
  const history = { ...previous.history, [previous.fen]: previous.views, [fen]: views };
  const keys = Object.keys(history);
  for (const key of keys.slice(0, Math.max(0, keys.length - 512))) delete history[key];
  return { fen, views, captured, moving, next: nextId, history };
}
