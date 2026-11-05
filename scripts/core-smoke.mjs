import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';

const origin = process.env.CHESSASH_URL || 'http://127.0.0.1:5174';
const server = process.env.CHESSASH_URL ? null : await createServer({ configFile: false, optimizeDeps: { entries: ['index.html'] }, server: { watch: { ignored: ['**/work/**', '**/android/**', '**/release/**', '**/resources/**'] }, host: '127.0.0.1', port: 5174, strictPort: true } });
await server?.listen();

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = existsSync(edge) ? edge : existsSync(chrome) ? chrome : undefined;
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/engine/COPYING.txt');
  await page.evaluate(baseUrl => {
    const base = document.createElement('base');
    base.href = baseUrl + '/';
    document.head.append(base);
  }, origin);
  const result = await page.evaluate(async () => {
    const core = await import('/src/core/index.ts');
    const game = core.parsePgn('[Event "Engine verification"]\n1. f3 e5 2. g4 Qh4# 0-1');
    const review = await core.analyzeGame(game, { depth: 8 });
    const matingPosition = await core.analyzePosition(game.positions[3], { depth: 8 });
    const terminal = await core.analyzePosition(game.positions[4], { depth: 8 });
    const saved = { ...game, review };
    await core.saveGame(saved);
    const loaded = (await core.loadGames()).find(item => item.id === game.id);
    const roundTrip = core.parsePgn(core.exportPgn(saved));
    const reclassified = await core.analyzeGame(saved, {
      depth: 8,
      classify: () => ({ label: 'good', key: true, hint: 'Test coaching-pack hint.' }),
    });
    const abort = new AbortController();
    abort.abort();
    const interrupted = await core.analyzeGame(core.parsePgn('1. e4 e5 *'), { depth: 12, signal: abort.signal });
    return {
      completed: review.completed,
      moves: review.results.map(item => ({ move: item.move, label: item.label, before: item.before, after: item.after, loss: item.loss })),
      best: matingPosition.best,
      terminal: terminal.score,
      persisted: loaded?.review?.results.length,
      roundTrip: roundTrip.positions.join('|') === game.positions.join('|'),
      cancelled: !interrupted.completed && interrupted.results.length === 0,
      reclassified: reclassified.results.every(item => item.label === 'good' && item.key && item.hints[0] === 'Test coaching-pack hint.'),
    };
  });
  assert.equal(result.completed, true);
  assert.equal(result.moves.length, 4);
  assert.equal(result.best, 'd8h4');
  assert.equal(result.terminal, -30000);
  assert.equal(result.persisted, 4);
  assert.equal(result.roundTrip, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.reclassified, true);
  assert.equal(result.moves[2].label, 'blunder');
  assert.equal(result.moves[3].move, 'd8h4');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify(result, null, 2));
  await page.evaluate(async () => {
    const core = await import('/src/core/index.ts');
    const games = await core.loadGames();
    for (const game of games.filter(item => item.headers.Event === 'Engine verification')) await core.deleteGame(game.id);
  });
} finally { await browser.close(); await server?.close(); }
