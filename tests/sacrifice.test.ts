import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { describe, expect, it, vi } from 'vitest';
import { parsePgn } from '../src/core/pgn';
import { sacrificeOffers, verifySacrifice } from '../src/core/sacrifice';
import type { EngineResult } from '../src/core/types';

const fixture = parsePgn(readFileSync(new URL('./fixtures/rook-stalemate.pgn', import.meta.url), 'utf8'));
const result = (fen: string, score = 0, depth = 14): EngineResult => ({ fen, score, depth, best: '', pv: [], lines: [] });

describe('sound material offers', () => {
  it('recognizes the supplied rook drawing mechanism even when the PV declines it', async () => {
    let found = 0;
    const search = vi.fn();
    for (let ply = 1; ply <= fixture.moves.length; ply += 2) {
      const before = new Chess(fixture.positions[ply - 1]), moved = before.move(fixture.moves[ply - 1]);
      const offers = sacrificeOffers(fixture.positions[ply - 1], moved.lan);
      const evidence = await verifySacrifice(before.fen(), offers, result(before.fen()), search);
      if (evidence) {
        expect(evidence.investment).toBeGreaterThanOrEqual(2);
        const accepted = new Chess(before.fen()); accepted.move(evidence.capture);
        expect(accepted.isStalemate()).toBe(true); found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(40);
    expect(search).not.toHaveBeenCalled();
  });
  it('excludes an equal piece exchange and offers already hanging before a quiet move', () => {
    const exchange = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 *');
    expect(sacrificeOffers(exchange.positions[6], 'b5c6')).toEqual([]);
    expect(sacrificeOffers('r7/7k/8/8/8/8/8/R6K w - - 0 1', 'h1h2')).toEqual([]);
  });
  it('recognizes the same stalemate offer for Black', async () => {
    const original = new Chess(fixture.positions[0]), mirror = new Chess(); mirror.clear();
    for (const piece of original.board().flat()) if (piece) mirror.put({ type: piece.type, color: piece.color === 'w' ? 'b' : 'w' }, (piece.square[0] + (9 - Number(piece.square[1]))) as Parameters<Chess['get']>[0]);
    const fields = mirror.fen().split(' '); fields[1] = 'b';
    const before = fields.join(' '), board = new Chess(before); board.move('d7d2');
    const evidence = await verifySacrifice(board.fen(), sacrificeOffers(before, 'd7d2'), result(board.fen()), vi.fn());
    expect(evidence?.outcome).toBe('stalemate');
    const accepted = new Chess(board.fen());
    expect(accepted.move(evidence!.capture)).toMatchObject({ color: 'w', captured: 'r' });
    expect(accepted.isStalemate()).toBe(true);
  });
  it('checks legal capture branches with the engine when material is offered for compensation', async () => {
    const game = parsePgn('1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 *');
    const fen = game.positions.at(-1)!, offers = sacrificeOffers(game.positions.at(-2)!, 'f3e5');
    expect(offers.some(offer => offer.capture === 'g4d1')).toBe(true);
    const search = vi.fn(async (_fen, options) => ({ ...result(fen, 20), pv: [options.moves[0]] }));
    expect((await verifySacrifice(fen, offers, result(fen, 20), search))?.outcome).toBe('compensation');
    expect(search.mock.calls[0][1]).toMatchObject({ depth: 14, multiPv: 1 });
    expect(await verifySacrifice(fen, offers, result(fen, -300), search)).toBeUndefined();
    expect(await verifySacrifice(fen, offers, result(fen, 20, 12), search)).toBeUndefined();
    expect(await verifySacrifice(fen, offers, result(fen), async () => ({ ...result(fen, -400), pv: [offers[0].capture] }))).toBeUndefined();
  });
  it('rejects illegal moves and cancelled proof searches', async () => {
    expect(sacrificeOffers(fixture.positions[0], 'd2d9')).toEqual([]);
    const board = new Chess(fixture.positions[0]); const move = board.move(fixture.moves[0]);
    await expect(verifySacrifice(board.fen(), sacrificeOffers(fixture.positions[0], move.lan), result(board.fen()), vi.fn(), AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });
});
