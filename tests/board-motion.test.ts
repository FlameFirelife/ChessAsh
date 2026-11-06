import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { initialBoardMotion, nextBoardMotion } from '../src/core/boardMotion';

describe('stable board movement', () => {
  it('keeps moving and stationary piece identities and ignores metadata refreshes', () => {
    const board = new Chess();
    const before = initialBoardMotion(board.fen());
    const pawn = before.views.find(p => p.sq === 'e2')!;
    board.move('e4');
    const after = nextBoardMotion(before, board.fen());
    expect(after.views.find(p => p.sq === 'e4')!.id).toBe(pawn.id);
    expect(after.moving).toEqual([pawn.id]);
    expect(nextBoardMotion(after, board.fen())).toBe(after);
    expect(after.views.find(p => p.sq === 'g1')).toEqual(before.views.find(p => p.sq === 'g1'));
  });
  it('restores the same captured piece on backward replay and recaptures once', () => {
    const board = new Chess(); board.move('e4'); board.move('d5');
    const before = initialBoardMotion(board.fen());
    const taken = before.views.find(p => p.sq === 'd5')!;
    const mover = before.views.find(p => p.sq === 'e4')!;
    board.move('exd5');
    const after = nextBoardMotion(before, board.fen());
    expect(after.captured).toEqual([taken]);
    expect(after.views.find(p => p.sq === 'd5')!.id).toBe(mover.id);
    const undo = nextBoardMotion(after, before.fen);
    expect(undo.views.find(p => p.sq === 'd5')!.id).toBe(taken.id);
    expect(undo.captured).toEqual([]);
    expect(nextBoardMotion(undo, after.fen).captured).toEqual([taken]);
  });
  it('moves both castling pieces with their original identities, forward and back', () => {
    const board = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const before = initialBoardMotion(board.fen());
    board.move('O-O');
    const after = nextBoardMotion(before, board.fen());
    expect(after.views.find(p => p.sq === 'g1')!.id).toBe(before.views.find(p => p.sq === 'e1')!.id);
    expect(after.views.find(p => p.sq === 'f1')!.id).toBe(before.views.find(p => p.sq === 'h1')!.id);
    const backward = nextBoardMotion(initialBoardMotion(after.fen), before.fen);
    expect(backward.views.find(p => p.sq === 'e1')!.id).toBe(initialBoardMotion(after.fen).views.find(p => p.sq === 'g1')!.id);
    expect(after.moving).toHaveLength(2);
  });
  it('keeps the pawn identity through underpromotion and reversal', () => {
    const board = new Chess('7k/1P6/8/8/8/8/8/K7 w - - 0 1');
    const before = initialBoardMotion(board.fen());
    const id = before.views.find(p => p.sq === 'b7')!.id;
    board.move('b8=N');
    const after = nextBoardMotion(before, board.fen());
    expect(after.views.find(p => p.sq === 'b8')).toMatchObject({ id, type: 'n' });
    const back = nextBoardMotion(after, before.fen);
    expect(back.views.find(p => p.sq === 'b7')).toMatchObject({ id, type: 'p' });
    expect(after.captured).toHaveLength(0);
  });
  it('removes the en passant pawn from its occupied square', () => {
    const board = new Chess();for (const move of ['e4','a6','e5','d5']) board.move(move);
    const before = initialBoardMotion(board.fen());
    board.move('exd6');
    const after = nextBoardMotion(before, board.fen());
    expect(after.captured).toHaveLength(1);
    expect(after.captured[0].sq).toBe('d5');
    expect(after.views.find(p => p.sq === 'd6')!.id).toBe(before.views.find(p => p.sq === 'e5')!.id);
  });
});
