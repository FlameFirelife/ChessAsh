import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import { Chess } from 'chess.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let app;
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  app = await electron.launch({ args: ['.'], env: { ...process.env, CHESSASH_TEST: '1', CHESSASH_DEV_URL: url, CHESSASH_TEST_DATA: path.resolve('work/qa/explanation-corpus-' + Date.now()) } });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const cases = [
    { name: 'quiet opening', pgn: '1. e4 e5 *', move: 'g1f3' },
    { name: 'ordinary exchange', pgn: '1. e4 d5 *', move: 'e4d5' },
    { name: 'early king diagonal', pgn: '1. e4 *', move: 'f7f6' },
    { name: 'allows immediate mate', pgn: '1. f3 e5 *', move: 'g2g4' },
    { name: 'misses immediate mate', pgn: '1. f3 e5 2. g4 *', move: 'b8c6' },
    { name: 'abandons rook defender', fen: 'r7/7k/8/8/8/2B5/8/R6K w - - 0 1', move: 'c3d2' },
    { name: 'black abandons rook defender', fen: 'r6k/8/2b5/8/8/8/7K/R7 b - - 0 1', move: 'c6d7' },
    { name: 'knight fork', fen: '7k/8/8/8/1n6/8/7P/R3K3 w - - 0 1', move: 'h2h3' },
    { name: 'castling', pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 *', move: 'e1g1' },
    { name: 'en passant', fen: '7k/8/8/3pP3/8/8/8/K7 w - d6 0 1', move: 'e5d6' },
    { name: 'underpromotion', fen: '8/k1P5/2K5/8/8/8/8/8 w - - 0 1', move: 'c7c8n' },
    { name: 'stalemate', fen: 'k7/8/1QK5/8/8/8/8/8 w - - 0 1', move: 'b6c7' },
  ];
  const rows = [];
  for (const entry of cases) {
    const row = await page.evaluate(async entry => {
      const { parsePgn } = await import('/src/core/pgn.ts');
      const { reviewVariationMove } = await import('/src/core/variationReview.ts');
      const { reviewCoaching } = await import('/src/core/coaching.ts');
      const fen = entry.fen || parsePgn(entry.pgn).positions.at(-1);
      let policyCalls = 0;
      const { game, result } = await reviewVariationMove(fen, entry.move, { depth: 10, classify: async facts => { policyCalls++; return (await window.chessash.reviewFacts([facts]))[0]; } });
      const snapshot = JSON.stringify({ game, result });
      const coaches = ['en', 'it'].flatMap(language => [undefined, 'w', 'b'].map(playerColor => {
        const c = reviewCoaching(game, result, { language, playerColor });
        return { language, playerColor, text: c.text, detail: c.detail, best: c.best, reason: c.alternativeReason, help: c.alternativeHelp?.kind, insight: c.insight?.kind };
      }));
      return { name: entry.name, fen, result, coaches, policyCalls, immutable: snapshot === JSON.stringify({ game, result }) };
    }, entry);
    assert.ok(row.policyCalls > 0, `${entry.name}: actual Foxash policy`);
    assert.ok(row.immutable, `${entry.name}: explanation mutated review`);
    assert.ok(Number.isFinite(row.result.loss));
    assert.equal(row.result.pv[0], row.result.best);
    const best = new Chess(row.fen); best.move(row.result.best);
    const actual = new Chess(row.fen); actual.move(entry.move);
    for (const move of row.result.replyPv.slice(0, 8)) actual.move(move);
    for (const coach of row.coaches) {
      assert.doesNotMatch(coach.text + coach.detail + coach.best, /undefined|NaN/);
      if (coach.reason) assert.ok(coach.detail.includes(coach.reason));
      if (row.result.best === entry.move || row.result.loss < 45) assert.equal(coach.help, undefined);
    }
    if (entry.name.includes('abandons rook defender')) {
      assert.equal(row.coaches[0].insight, 'abandoned-defender');
      assert.equal(row.coaches[0].help, 'removes-attacker');
    }
    if (entry.name === 'misses immediate mate') assert.equal(row.coaches[0].help, 'mate');
    if (entry.name === 'allows immediate mate') assert.match(row.coaches[0].text, /mate/);
    if (entry.name === 'stalemate') assert.match(row.coaches[0].text, /stalemate/);
    rows.push(row);
    console.log(`${entry.name}: ${row.result.label}, loss ${row.result.loss}, ${row.coaches[0].help || 'neutral comparison'}`);
  }
  assert.deepEqual(errors, []);
  await mkdir('verification', { recursive: true });
  await writeFile('verification/explanation-corpus-results.json', JSON.stringify({ passed: true, cases: rows.length, rows, limitation: 'Twelve bounded real-engine positions and structural counterexamples; not a chess-strength benchmark, exhaustive strategy evaluation or physical Android test.' }, null, 2));
  console.log('Explanation corpus passed.');
} finally {
  if (app) await app.close();
  await server.close();
}
